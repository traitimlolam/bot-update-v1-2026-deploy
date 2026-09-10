import 'dotenv/config';
import express, { Request, Response } from 'express';
import { handleWebhookEvent, verifySignature, verifyWebhook } from './webhook/facebook';
import { PRIVACY_POLICY_HTML } from './privacyPolicy';
import { runDailyReminderSweep, startDailyReminderScheduler } from './services/reminderService';
import { executeAutoPost, startAutoPostScheduler, PostTopic } from './services/autoPostService';

const FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) {
  throw new Error('FB_APP_SECRET chưa được cấu hình trong .env — không thể khởi động server an toàn.');
}
if (!process.env.FB_VERIFY_TOKEN) {
  throw new Error('FB_VERIFY_TOKEN chưa được cấu hình trong .env — webhook GET verify sẽ luôn thất bại.');
}

const app = express();

app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

app.get('/webhook', verifyWebhook);

app.post('/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const signature = req.header('X-Hub-Signature-256');

  if (!verifySignature(req.rawBody ?? Buffer.from(''), signature, FB_APP_SECRET)) {
    res.sendStatus(403);
    return;
  }

  try {
    await handleWebhookEvent(req, res);
  } catch (err) {
    console.error('[handleWebhookEvent] unexpected error', err);
    if (!res.headersSent) res.sendStatus(500);
  }
});


app.get('/privacy', (_req, res) => res.type('html').send(PRIVACY_POLICY_HTML));
app.get('/data-deletion', (_req, res) => res.type('html').send(PRIVACY_POLICY_HTML));
app.get('/health', (_req, res) => res.sendStatus(200));

app.get('/cron/daily-reminder', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const dryRun = req.query.dryRun === 'true';
    const result = await runDailyReminderSweep({ force, dryRun });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/cron/daily-reminder', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const dryRun = req.query.dryRun === 'true';
    const result = await runDailyReminderSweep({ force, dryRun });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Route kích hoạt đăng bài tự động (hỗ trợ gọi bằng Cloud Scheduler hoặc test thủ công)
 */
app.post('/cron/auto-post', async (req: Request, res: Response) => {
  try {
    const topic = (req.body?.topic || req.query?.topic) as PostTopic | undefined;
    const result = await executeAutoPost(topic);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/cron/auto-post', async (req: Request, res: Response) => {
  try {
    const topic = req.query.topic as PostTopic | undefined;
    const result = await executeAutoPost(topic);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Bot server listening on port ${port}`);
  startDailyReminderScheduler();
  startAutoPostScheduler();
});

export { app };
