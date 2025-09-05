/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import UPowerGlib from 'gi://UPowerGlib';
import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(settings, uuid) {
        super._init(0.0, _('Battery Indicator'));

        // UI: icon + small percentage label
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.Icon({
            icon_name: 'battery-empty-symbolic',
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: '--% ',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
    // Settings (provided by extension instance) and uuid
    this._settings = settings;
    this._uuid = uuid;
    this._settings = settings;

        // Periodic refresh (for rivalcfg polling)
        const every = () => Math.max(5, this._settings?.get_int('refresh-seconds') ?? 60);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, every(), () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });

        // React to settings changes
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', () => {
                this._update();
                // Reset timer to apply new interval immediately
                if (this._timeoutId) {
                    GLib.source_remove(this._timeoutId);
                }
                const every = () => Math.max(5, this._settings?.get_int('refresh-seconds') ?? 60);
                this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, every(), () => {
                    this._update();
                    return GLib.SOURCE_CONTINUE;
                });
            });
        }

        // Menu items
        this._percentItem = new PopupMenu.PopupMenuItem(_('Rivalcfg: —'));
        this._percentItem.reactive = false;
        this._percentItem.can_focus = false;
        this.menu.addMenuItem(this._percentItem);

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem(_('Preferences…'));
        prefsItem.connect('activate', () => {
            try {
                ExtensionUtils.openPrefs();
            } catch (e) {
                try {
                    if (this._uuid)
                        Main.extensionManager.openExtensionPrefs(this._uuid, '', {});
                } catch (err) {
                    logError(err);
                }
            }
        });
        this.menu.addMenuItem(prefsItem);

        this._update();
    }

    // Settings are injected from the extension; no local retrieval here.

    _formatIconName(percentage, charging) {
        let level = Math.max(0, Math.min(100, Math.round(percentage)));
        // Map to nearest 10 (0,10,...,100)
        level = Math.round(level / 10) * 10;
        // Ensure canonical names exist for 0 and 100
        if (level === 0)
            level = 0;
        if (level === 100)
            level = 100;
        const base = `battery-level-${level}-symbolic`;
        const chargingBase = `battery-level-${level}-charging-symbolic`;
        return charging ? chargingBase : base;
    }

    _stateToText(state) {
        switch (state) {
        case UPowerGlib.DeviceState.CHARGING:
        case UPowerGlib.DeviceState.PENDING_CHARGE:
            return _('Charging');
        case UPowerGlib.DeviceState.DISCHARGING:
        case UPowerGlib.DeviceState.PENDING_DISCHARGE:
            return _('Discharging');
        case UPowerGlib.DeviceState.FULLY_CHARGED:
            return _('Fully charged');
        case UPowerGlib.DeviceState.EMPTY:
            return _('Empty');
        default:
            return _('Unknown');
        }
    }

    _parseScriptOutput(text) {
        // Expected examples:
        // "Discharging [========= ] 95 %"
        // "Charging [===== ] 40 %"
        // rivalcfg may also output e.g. "Battery level: 90%" or just "90".
        // Be lenient: grab first number 0-100 with optional % after it.
        const percentMatch = text.match(/(?:^|\D)(100|\d?\d)(?:\s*%|\b)/);
        // Use word boundaries to not match "charging" inside "discharging"
        const isDischarging = /\bdischarging\b/i.test(text);
        const isCharging = /\bcharging\b/i.test(text) && !isDischarging;
        if (!percentMatch)
            return null;
        const p = Number(percentMatch[1]);
        let state = UPowerGlib.DeviceState.UNKNOWN;
        if (isCharging)
            state = UPowerGlib.DeviceState.CHARGING;
        else if (isDischarging)
            state = UPowerGlib.DeviceState.DISCHARGING;
        return { percent: p, state, charging: isCharging };
    }

    _runRivalcfgOnce() {
        // Try to retrieve battery level via rivalcfg directly.
        const runProc = (argv) => new Promise(resolve => {
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout, stderr] = p.communicate_utf8_finish(res);
                        const out = (stdout?.trim() ?? '');
                        const err = (stderr?.trim() ?? '');
                        const ok = typeof p.get_successful === 'function' ? p.get_successful() : true;
                        resolve({ out: out || err, ok });
                    } catch (e) {
                        resolve({ out: '', ok: false });
                    }
                });
            } catch (e) {
                resolve({ out: '', ok: false });
            }
        });

        return new Promise(async resolve => {
            // 1) Use /usr/bin/env to resolve from PATH
            let r = await runProc(['/bin/sh', '-c', '/usr/bin/env rivalcfg --battery-level']);
            if (r.out) { resolve(r.out); return; }
            // 2) Try a login shell which may load user profile PATH
            r = await runProc(['/bin/bash', '-lc', 'rivalcfg --battery-level']);
            if (r.out) { resolve(r.out); return; }
            // 3) Try python -m rivalcfg
            r = await runProc(['/bin/bash', '-lc', 'python -m rivalcfg --battery-level']);
            if (r.out) { resolve(r.out); return; }
            resolve(null);
        });
    }

    async _resolveRivalcfgPath() {
        const cmd = `command -v rivalcfg 2>/dev/null || true`;
        const out = await new Promise(resolve => {
            try {
                const proc = Gio.Subprocess.new(['/bin/sh', '-c', cmd], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        resolve(stdout?.trim() ?? '');
                    } catch (e) {
                        resolve('');
                    }
                });
            } catch (e) {
                resolve('');
            }
        });
        return out || null;
    }

    async _update() {
        // 1) Prefer rivalcfg directly
        const rcOut = await this._runRivalcfgOnce();
        if (rcOut) {
            log(`[kewu] rivalcfg output: ${rcOut}`);
            const parsed = this._parseScriptOutput(rcOut);
            if (parsed) {
                this._icon.icon_name = this._formatIconName(parsed.percent, parsed.charging);
                this._label.text = `${Math.round(parsed.percent)}%`;
                this._percentItem.label.text = `${_('Rivalcfg')}: ${Math.round(parsed.percent)}% · ${this._stateToText(parsed.state)}`;
                this.accessible_name = `${_('Battery Indicator')}: ${Math.round(parsed.percent)}%`;
                return;
            } else {
                const shown = rcOut.length > 80 ? rcOut.slice(0, 80) + '…' : rcOut;
                this._percentItem.label.text = `${_('Rivalcfg')}: ${_('Unrecognized')} → ${shown}`;
            }
        } else {
            const foundPath = await this._resolveRivalcfgPath();
            const suffix = foundPath ? `${_('found at')} ${foundPath}` : _('not found in PATH');
            this._percentItem.label.text = `${_('Rivalcfg')}: ${_('No output')} (${suffix})`;
        }

        // If rivalcfg failed entirely, show a generic error
        if (!rcOut) {
            this._icon.icon_name = 'battery-missing-symbolic';
            this._label.text = '--%';
            this._percentItem.label.text = _('Rivalcfg not available');
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        super.destroy();
    }
});

export default class IndicatorExampleExtension extends Extension {
    enable() {
    // metadata.json contains settings-schema, so this.getSettings() resolves it
    const settings = this.getSettings();
    this._indicator = new Indicator(settings, this.uuid);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
