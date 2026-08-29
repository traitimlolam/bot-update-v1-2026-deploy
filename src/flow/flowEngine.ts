import { checkPhone, PhoneErrorType } from './phoneValidator';

export type ConversationState = 'NEW' | 'IN_PROGRESS' | 'CLOSED';

export interface ConversationRecord {
  state: ConversationState;
  phone: string | null;
  assignedStaff: string | null;
}

export function newConversation(): ConversationRecord {
  return { state: 'NEW', phone: null, assignedStaff: null };
}

export type MessageCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6_SHORT' | 'M6_LONG' | 'M6_INVALID';

export type FlowInput =
  | { type: 'BUTTON'; payload: 'BTN_LOCATION' | 'BTN_LEGAL' | 'BTN_PRICE' }
  | { type: 'TEXT'; text: string }
  | { type: 'FEED_COMMENT' };

export interface FlowOptions {
  remindWhenInProgress: boolean;
}

export interface FlowResult {
  record: ConversationRecord;
  messagesToSend: MessageCode[];
  leadPhone: string | null;
}

const LOCATION_OR_PRICE_SEQUENCE: MessageCode[] = ['M1', 'M2', 'M3'];
const LEGAL_SEQUENCE: MessageCode[] = ['M1', 'M4', 'M3'];

function phoneErrorToMessage(errorType: PhoneErrorType): MessageCode {
  switch (errorType) {
    case 'missing':
      return 'M6_SHORT';
    case 'excess':
      return 'M6_LONG';
    case 'invalidPrefix':
      return 'M6_INVALID';
  }
}

export function processInput(
  current: ConversationRecord,
  input: FlowInput,
  options: FlowOptions
): FlowResult {
  if (current.state === 'CLOSED') {
    return { record: current, messagesToSend: [], leadPhone: null };
  }

  if (input.type === 'TEXT') {
    const phoneCheck = checkPhone(input.text);

    if (phoneCheck.valid && phoneCheck.normalizedPhone) {
      const record: ConversationRecord = {
        state: 'CLOSED',
        phone: phoneCheck.normalizedPhone,
        assignedStaff: current.assignedStaff,
      };
      return { record, messagesToSend: ['M5'], leadPhone: phoneCheck.normalizedPhone };
    }

    if (phoneCheck.errorType !== null) {
      return {
        record: current,
        messagesToSend: [phoneErrorToMessage(phoneCheck.errorType)],
        leadPhone: null,
      };
    }

    if (current.state === 'NEW') {
      return {
        record: { ...current, state: 'IN_PROGRESS' },
        messagesToSend: LOCATION_OR_PRICE_SEQUENCE,
        leadPhone: null,
      };
    }

    if (options.remindWhenInProgress) {
      return { record: current, messagesToSend: ['M3'], leadPhone: null };
    }
    return { record: current, messagesToSend: [], leadPhone: null };
  }

  if (input.type === 'BUTTON') {
    const sequence =
      input.payload === 'BTN_LEGAL' ? LEGAL_SEQUENCE : LOCATION_OR_PRICE_SEQUENCE;
    return {
      record: { ...current, state: 'IN_PROGRESS' },
      messagesToSend: sequence,
      leadPhone: null,
    };
  }

  if (current.state === 'NEW') {
    return {
      record: { ...current, state: 'IN_PROGRESS' },
      messagesToSend: LOCATION_OR_PRICE_SEQUENCE,
      leadPhone: null,
    };
  }
  return { record: current, messagesToSend: [], leadPhone: null };
}
