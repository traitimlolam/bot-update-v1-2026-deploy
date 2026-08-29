import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { loadMessages } from '../config/loadConfig';
import {
  ConversationRecord,
  FlowInput,
  MessageCode,
  newConversation,
  processInput,
} from '../flow/flowEngine';
import { getConversation, getDb, logError, saveConversation, withLock } from '../state/firestore';
import { appendLead } from '../services/sheetsService';
import { withRetry } from '../util/retry';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MIN_DELAY_BETWEEN_MESSAGES_MS = 2000;

export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
}

export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedHash = signatureHeader.slice('sha256='.length);
  const computedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expectedHash, 'hex');
  const computedBuf = Buffer.from(computedHash, 'hex');
  if (expectedBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, computedBuf);
}

async function callSendApi(body: Record<string, unknown>): Promise<{ recipient_id?: string }> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  return withRetry(async () => {
    const response = await fetch(`${GRAPH_BASE_URL}/me/messages?access_token=${pageAccessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Facebook Send API error ${response.status}: ${text}`);
    }
    return (await response.json()) as { recipient_id?: string };
  });
}

type Recipient = { id: string } | { comment_id: string };

async function sendTypingOn(recipient: Recipient): Promise<void> {
  await callSendApi({ recipient, sender_action: 'typing_on' });
}

async function sendText(recipient: Recipient, text: string): Promise<string | undefined> {
  const result = await callSendApi({
    recipient,
    messaging_type: 'RESPONSE',
    message: { text },
  });
  return result.recipient_id;
}

async function sendQuickReplyButtons(psid: string): Promise<void> {
  const messages = loadMessages();
  await callSendApi({
    recipient: { id: psid },
    messaging_type: 'RESPONSE',
    message: {
      text: messages.M1,
      quick_replies: messages.buttons.map((b) => ({
        content_type: 'text',
        title: b.label,
        payload: b.payload,
      })),
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessageSequence(
  recipient: Recipient,
  codes: MessageCode[]
): Promise<string | undefined> {
  const messages = loadMessages();
  let resolvedPsid: string | undefined;
  let currentRecipient = recipient;

  for (let i = 0; i < codes.length; i++) {
    await sendTypingOn(currentRecipient);
    const recipientId = await sendText(currentRecipient, messages[codes[i]]);
    if (recipientId && !resolvedPsid) {
      resolvedPsid = recipientId;
      currentRecipient = { id: recipientId };
    }
    if (i < codes.length - 1) {
      await delay(MIN_DELAY_BETWEEN_MESSAGES_MS);
    }
  }
  return resolvedPsid;
}

async function loadOrCreateConversation(psid: string): Promise<ConversationRecord> {
  const stored = await getConversation(psid);
  return stored ?? newConversation();
}

export async function runFlowTurn(
  psid: string,
  input: FlowInput,
  getCustomerName: () => Promise<string | null>
): Promise<void> {
  await withLock(`psid:${psid}`, async () => {
    const messages = loadMessages();
    const current = await loadOrCreateConversation(psid);
    const result = processInput(current, input, {
      remindWhenInProgress: messages.remindWhenInProgress,
    });

    if (result.messagesToSend.length > 0) {
      try {
        await sendMessageSequence({ id: psid }, result.messagesToSend);
      } catch (err) {
        await logError('sendMessageSequence', err, { psid, input });
      }
    }

    let finalRecord = result.record;

    if (result.leadPhone) {
      try {
        const customerName = await getCustomerName();
        const assignedStaff = await appendLead({
          phone: result.leadPhone,
          customerName,
        });
        finalRecord = { ...finalRecord, assignedStaff };
      } catch (err) {
        await logError('appendLead', err, {
          psid,
          phone: result.leadPhone,
        });
      }
    }

    try {
      await saveConversation(psid, finalRecord);
    } catch (err) {
      await logError('saveConversation', err, { psid, finalRecord });
    }
  });
}

interface MessagingEvent {
  sender: { id: string };
  message?: { text?: string; quick_reply?: { payload?: string }; is_echo?: boolean };
  postback?: { payload?: string };
}

const KNOWN_BUTTON_PAYLOADS = ['BTN_LOCATION', 'BTN_LEGAL', 'BTN_PRICE'] as const;

function isKnownButtonPayload(
  payload: string | undefined
): payload is (typeof KNOWN_BUTTON_PAYLOADS)[number] {
  return !!payload && (KNOWN_BUTTON_PAYLOADS as readonly string[]).includes(payload);
}

async function fetchCustomerName(psid: string): Promise<string | null> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  try {
    const response = await fetch(
      `${GRAPH_BASE_URL}/${psid}?fields=first_name,last_name&access_token=${pageAccessToken}`
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { first_name?: string; last_name?: string };
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
    return name || null;
  } catch {
    return null;
  }
}

async function handleMessagingEvent(event: MessagingEvent): Promise<void> {
  const psid = event.sender.id;

  if (event.postback?.payload === 'GET_STARTED') {
    await handleFirstOpen(psid);
    return;
  }

  const buttonPayload = event.postback?.payload ?? event.message?.quick_reply?.payload;
  if (isKnownButtonPayload(buttonPayload)) {
    await runFlowTurn(psid, { type: 'BUTTON', payload: buttonPayload }, () => fetchCustomerName(psid));
    return;
  }

  const text = event.message?.text;
  if (typeof text === 'string' && text.length > 0) {
    await runFlowTurn(psid, { type: 'TEXT', text }, () => fetchCustomerName(psid));
  }
}

async function handleFirstOpen(psid: string): Promise<void> {
  try {
    await sendTypingOn({ id: psid });
    await sendQuickReplyButtons(psid);
  } catch (err) {
    await logError('handleFirstOpen', err, { psid });
  }
}

interface FeedCommentValue {
  item: string;
  verb: string;
  comment_id?: string;
  from?: { id: string; name?: string };
}

const COMMENT_AUTHORS_COLLECTION = 'commentAuthors';

async function getMappedPsid(commenterId: string): Promise<string | null> {
  const doc = await getDb().collection(COMMENT_AUTHORS_COLLECTION).doc(commenterId).get();
  if (!doc.exists) return null;
  return (doc.data()?.psid as string) ?? null;
}

async function saveMappedPsid(commenterId: string, psid: string): Promise<void> {
  await getDb().collection(COMMENT_AUTHORS_COLLECTION).doc(commenterId).set({ psid });
}

async function handleFeedChange(value: FeedCommentValue): Promise<void> {
  if (value.item !== 'comment' || value.verb !== 'add' || !value.comment_id || !value.from) {
    return;
  }

  const commenterId = value.from.id;
  const commentId = value.comment_id;
  const customerName = value.from.name ?? null;

  await withLock(`commentAuthor:${commenterId}`, async () => {
    const mappedPsid = await getMappedPsid(commenterId);

    if (mappedPsid) {
      await runFlowTurn(mappedPsid, { type: 'FEED_COMMENT' }, async () => customerName);
      return;
    }

    const messages = loadMessages();
    let resolvedPsid: string | undefined;
    try {
      await sendTypingOn({ comment_id: commentId });
      resolvedPsid = await sendText({ comment_id: commentId }, messages.M1);
    } catch (err) {
      await logError('handleFeedChange_sendM1', err, { commentId, commenterId });
      return;
    }

    if (!resolvedPsid) {
      await logError('handleFeedChange', new Error('Facebook did not return recipient_id for private reply'), {
        commentId,
        commenterId,
      });
      return;
    }

    await saveMappedPsid(commenterId, resolvedPsid);

    const existing = await getConversation(resolvedPsid);
    if (existing && existing.state !== 'NEW') {
      return;
    }

    try {
      await delay(MIN_DELAY_BETWEEN_MESSAGES_MS);
      await sendMessageSequence({ id: resolvedPsid }, ['M2', 'M3']);
      await saveConversation(resolvedPsid, { state: 'IN_PROGRESS', phone: null, assignedStaff: null });
    } catch (err) {
      await logError('handleFeedChange_sendRest', err, { commentId, commenterId, resolvedPsid });
    }
  });
}

interface WebhookEntry {
  messaging?: MessagingEvent[];
  changes?: { field: string; value: FeedCommentValue }[];
}

interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

export async function handleWebhookEvent(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const body = req.body as WebhookBody | undefined;
    if (!body || body.object !== 'page') return;

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        try {
          if (!event.message && !event.postback) continue;
          if (event.message?.is_echo) continue;
          await handleMessagingEvent(event);
        } catch (err) {
          await logError('handleMessagingEvent', err, { event });
        }
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== 'feed') continue;
        try {
          await handleFeedChange(change.value);
        } catch (err) {
          await logError('handleFeedChange_top', err, { change });
        }
      }
    }
  } catch (err) {
    await logError('handleWebhookEvent', err, { body: req.body });
  }
}

export { handleFirstOpen };
