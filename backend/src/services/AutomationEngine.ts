import { DeviceManager } from './DeviceManager.js';
import { Database } from '../db/Database.js';
import { AutomationRule } from '../types/index.js';

export class AutomationEngine {
  private static instance: AutomationEngine;
  private db: Database;
  private deviceManager: DeviceManager;

  private constructor() {
    this.db = Database.getInstance();
    this.deviceManager = DeviceManager.getInstance();
  }

  public static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  public initialize(): void {
    console.log('[AutomationEngine] Subscribing to IoT telemetry and motion events...');

    this.deviceManager.on('motion_event', async (event: { deviceId: string; detected: boolean; timestamp: number }) => {
      if (!event.detected) return;
      await this.evaluateMotionRules(event.deviceId);
    });

    this.deviceManager.on('device_state', async (event: { deviceId: string; state: Record<string, any> }) => {
      await this.evaluateStateRules(event.deviceId, event.state);
    });
  }

  private async evaluateMotionRules(triggerDeviceId: string): Promise<void> {
    const rules = this.db.getAllAutomations().filter((r) => r.enabled && r.trigger.type === 'motion');

    for (const rule of rules) {
      if (!rule.trigger.deviceId || rule.trigger.deviceId === triggerDeviceId) {
        console.log(`[AutomationEngine] Motion rule matched: '${rule.name}' triggered by ${triggerDeviceId}`);
        await this.executeAction(rule);
      }
    }
  }

  private async evaluateStateRules(triggerDeviceId: string, state: Record<string, any>): Promise<void> {
    const rules = this.db.getAllAutomations().filter((r) => r.enabled && r.trigger.type === 'state_change');

    for (const rule of rules) {
      if (rule.trigger.deviceId === triggerDeviceId && rule.trigger.property) {
        const prop = rule.trigger.property;
        const val = state[prop];
        if (val !== undefined) {
          const operator = rule.trigger.operator || '==';
          let match = false;
          if (operator === '==' && val == rule.trigger.value) match = true;
          if (operator === '!=' && val != rule.trigger.value) match = true;
          if (operator === '>' && val > rule.trigger.value) match = true;
          if (operator === '<' && val < rule.trigger.value) match = true;
          if (operator === 'is_true' && Boolean(val)) match = true;

          if (match) {
            console.log(`[AutomationEngine] State condition matched for '${rule.name}'`);
            await this.executeAction(rule);
          }
        }
      }
    }
  }

  private async executeAction(rule: AutomationRule): Promise<void> {
    try {
      if (rule.action.type === 'device_command') {
        const { deviceId, command } = rule.action;
        console.log(`[AutomationEngine] Executing action on ${deviceId}:`, command);
        await this.deviceManager.sendCommand(deviceId, command);
      }
      rule.lastTriggered = Date.now();
      this.db.upsertAutomation(rule);
    } catch (err: any) {
      console.error(`[AutomationEngine] Action execution failed for rule ${rule.id}:`, err.message);
    }
  }
}

