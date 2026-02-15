
export enum SystemActionType {
  VOLUME = 'VOLUME',
  NETWORK = 'NETWORK',
  APP = 'APP',
  POWER = 'POWER',
  WEB = 'WEB',
  BRIGHTNESS = 'BRIGHTNESS',
}

export interface SystemAction {
  id: string;
  type: SystemActionType;
  command: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed';
}

export interface TranscriptionItem {
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface AppConfig {
  voice: 'Kore' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  model: string;
  sensitivity: 'low' | 'medium' | 'high';
}
