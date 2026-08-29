import 'dotenv/config';
import express, { Request, Response } from 'express';
import { handleWebhookEvent, verifySignature, verifyWebhook } from './webhook/facebook';

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

app.post('/webhook', (req: Request & { rawBody?: Buffer }, res: Response) => {
  const signature = req.header('X-Hub-Signature-256');

  if (!verifySignature(req.rawBody ?? Buffer.from(''), signature, FB_APP_SECRET)) {
    res.sendStatus(403);
    return;
  }

  handleWebhookEvent(req, res).catch((err) => {
    console.error('[handleWebhookEvent] unexpected error after response sent', err);
  });
});

app.get('/health', (_req, res) => res.sendStatus(200));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Bot server listening on port ${port}`);
});

export { app };
