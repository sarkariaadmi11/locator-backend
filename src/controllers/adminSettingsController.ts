import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {LAUNCH_PRESETS, LaunchPresetName, SettingsKey, SettingsKeyValue, settingsService} from '../services/settingsService';
import {sendSuccess} from '../utils/apiResponse';
import {HttpError} from '../utils/httpError';

const BOOLEAN_KEYS: Set<string> = new Set(
  Object.entries({
    [SettingsKey.MODERATION_TOGGLE]: 'boolean',
    [SettingsKey.ENABLE_REFERRALS]: 'boolean',
    [SettingsKey.ENABLE_CREATOR_LEVELS]: 'boolean',
    [SettingsKey.ENABLE_PURCHASE_CONNECTS]: 'boolean',
    [SettingsKey.ENABLE_PURCHASE_CREDITS]: 'boolean',
    [SettingsKey.ENABLE_WITHDRAWAL]: 'boolean',
    [SettingsKey.ENABLE_DAILY_LOGIN_BONUS]: 'boolean',
  }).map(([k]) => k),
);

/**
 * v2.1 Feature Flags / Economy Settings — Admin-only (PRD §5.14.11, backend Phase 6). Single
 * consolidated surface on top of `settingsService`. Every field change requires a mandatory
 * reason (`setValidatedSettingSchema`), audit-logged and version-tracked by `settingsService`
 * itself. **Not yet done:** Launch-Stage Presets (Beta/Public/Promotional, diff-preview) — this
 * is a plain get/list/set surface, not the one-click preset switcher the plan's item 6 asks for.
 */
export const adminSettingsController = {
  async listAll(_req: AdminRequest, res: Response) {
    const data = await settingsService.listAll();
    sendSuccess(res, 200, 'Settings fetched.', data);
  },

  async setSetting(req: AdminRequest, res: Response) {
    const key = req.params.key as SettingsKeyValue;
    if (!Object.values(SettingsKey).includes(key)) {
      throw new HttpError(404, `Unknown settings key "${key}".`);
    }
    const {value, reason} = req.body as {value: number | boolean; reason: string};

    if (BOOLEAN_KEYS.has(key)) {
      await settingsService.setBoolean(key, Boolean(value), req.admin!.id, reason);
    } else {
      await settingsService.setNumber(key, Number(value), req.admin!.id, reason);
    }

    sendSuccess(res, 200, 'Setting updated.', {key, value});
  },

  // --- Moderation Toggle convenience endpoints (backend Phase 5, kept for the dedicated
  // Moderation Toggle UI surface distinct from the generic settings table above). ---
  async getModerationToggle(_req: AdminRequest, res: Response) {
    const enabled = await settingsService.isModerationEnabled();
    sendSuccess(res, 200, 'Moderation toggle fetched.', {enabled});
  },

  async setModerationToggle(req: AdminRequest, res: Response) {
    const {enabled, reason} = req.body as {enabled: boolean; reason: string};
    await settingsService.setModerationEnabled(enabled, req.admin!.id, reason);
    sendSuccess(res, 200, `Moderation ${enabled ? 'enabled' : 'disabled'}.`, {enabled});
  },

  // --- Launch-Stage Presets (PRD §5.14.11 "Beta Launch / Public Launch / Promotional
  // Campaign, one-click with diff-preview before commit") ------------------------------------

  async previewPreset(req: AdminRequest, res: Response) {
    const name = (req.params.name as string).toUpperCase() as LaunchPresetName;
    if (!(name in LAUNCH_PRESETS)) {
      throw new HttpError(404, `Unknown preset "${req.params.name}". Valid presets: ${Object.keys(LAUNCH_PRESETS).join(', ')}.`);
    }
    const diff = await settingsService.previewPreset(name);
    sendSuccess(res, 200, 'Preset diff computed.', diff);
  },

  async applyPreset(req: AdminRequest, res: Response) {
    const name = (req.params.name as string).toUpperCase() as LaunchPresetName;
    if (!(name in LAUNCH_PRESETS)) {
      throw new HttpError(404, `Unknown preset "${req.params.name}". Valid presets: ${Object.keys(LAUNCH_PRESETS).join(', ')}.`);
    }
    const {reason} = req.body as {reason: string};
    const applied = await settingsService.applyPreset(name, req.admin!.id, reason);
    sendSuccess(res, 200, `Preset "${name}" applied.`, applied);
  },
};
