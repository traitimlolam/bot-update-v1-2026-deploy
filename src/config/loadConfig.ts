import messagesJson from './messages.json';

export interface MessageButton {
  label: string;
  payload: string;
}

export interface MessagesConfig {
  M1: string;
  M2: string;
  M3: string;
  M4: string;
  M5: string;
  M6_SHORT: string;
  M6_LONG: string;
  M6_INVALID: string;
  M7: string;
  buttons: MessageButton[];
}

export function loadMessages(): MessagesConfig {
  return messagesJson as MessagesConfig;
}
