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
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

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

    // UPower client and display device (fallback/default)
        this._upClient = UPowerGlib.Client.new();
        this._device = this._upClient.get_display_device();
        this._signalIds = [];

        if (this._device) {
            this._signalIds.push(this._device.connect('notify::percentage', () => this._update()));
            this._signalIds.push(this._device.connect('notify::state', () => this._update()));
            this._signalIds.push(this._device.connect('notify::is-present', () => this._update()));
        }

        // Periodic refresh (for script polling and UPower fallback)
        const every = () => Math.max(5, this._settings?.get_int('refresh-seconds') ?? 60);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, every(), () => {
            this._update();
            // Re-read in case the setting changed mid-session
            GLib.source_remove(this._timeoutId);
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, every(), () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_CONTINUE;
        });

        // React to settings changes
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', () => this._update());
        }

        // Menu items
    this._percentItem = new PopupMenu.PopupMenuItem(_('Battery: --%'));
    this._percentItem.reactive = false;
    this._percentItem.can_focus = false;
    this.menu.addMenuItem(this._percentItem);

        const stateItem = new PopupMenu.PopupMenuItem(_('Open Power Settings'));
        stateItem.connect('activate', () => Util.spawn(['gnome-control-center', 'power']));
        this.menu.addMenuItem(stateItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    // Diagnostics: last script output (non-reactive)
    this._scriptDiagItem = new PopupMenu.PopupMenuItem(_('Script: —'));
    this._scriptDiagItem.reactive = false;
    this._scriptDiagItem.can_focus = false;
    this.menu.addMenuItem(this._scriptDiagItem);

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
            const extraPath = this._settings?.get_string('extra-path')?.trim();
            const prefix = extraPath ? `PATH=${extraPath}:$PATH ` : '';
            // 1) Use /usr/bin/env to resolve from PATH
            let r = await runProc(['/bin/sh', '-c', `${prefix}/usr/bin/env rivalcfg --battery-level`]);
            if (r.out) { resolve(r.out); return; }
            // 2) Try a login shell which may load user profile PATH
            r = await runProc(['/bin/bash', '-lc', `${prefix}rivalcfg --battery-level`]);
            if (r.out) { resolve(r.out); return; }
            // 3) If Extra PATH is provided, try absolute path(s)
            if (extraPath) {
                const dirs = extraPath.split(':').filter(Boolean);
                for (const d of dirs) {
                    const candidate = GLib.build_filenamev([d, 'rivalcfg']);
                    try {
                        const f = Gio.File.new_for_path(candidate);
                        if (f.query_exists(null)) {
                            r = await runProc(['/bin/sh', '-c', `${prefix}${candidate} --battery-level`]);
                            if (r.out) { resolve(r.out); return; }
                        }
                    } catch (_) {
                        // ignore and continue
                    }
                }
            }
            // 4) Try python -m rivalcfg (uses venv python if Extra PATH points to venv/bin)
            r = await runProc(['/bin/bash', '-lc', `${prefix}python -m rivalcfg --battery-level`]);
            if (r.out) { resolve(r.out); return; }
        resolve(null);
        });
    }

    async _resolveRivalcfgPath() {
        const extraPath = this._settings?.get_string('extra-path')?.trim();
        const prefix = extraPath ? `PATH=${extraPath}:$PATH ` : '';
        const cmd = `${prefix}command -v rivalcfg 2>/dev/null || true`;
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

    _runScriptOnce(path) {
        // Tries a couple of strategies so users can either input a plain file path
        // (even if not executable) or a full shell command like "bash ~/script.sh".
        const isLikelyPath = s => /^(~\/|\.\/|\/)/.test(s.trim()) && !/\s/.test(s.trim());

    const runProc = (argv) => new Promise(resolve => {
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout, stderr] = p.communicate_utf8_finish(res);
                        const out = (stdout?.trim() ?? '');
                        const err = (stderr?.trim() ?? '');
                        // Accept output even if exit code != 0; prefer stdout, then stderr
                        resolve({ out: out || err, ok: true });
                    } catch (e) {
                        resolve({ out: '', ok: false });
                    }
                });
            } catch (e) {
                resolve({ out: '', ok: false });
            }
        });

        return new Promise(async resolve => {
            const trimmed = (path ?? '').trim();
            if (!trimmed) {
                resolve(null);
                return;
            }

            // 1) If it's a simple path, first try running it through bash directly
            if (isLikelyPath(trimmed)) {
                const extraPath = this._settings?.get_string('extra-path')?.trim();
                const prefix = extraPath ? `PATH=${extraPath}:$PATH ` : '';
                let r = await runProc(['/bin/sh', '-c', `${prefix}${trimmed}`]);
                if (r.out) { resolve(r.out); return; }
                // 2) Fallback to running via /bin/sh -c
                r = await runProc(['/bin/sh', '-c', trimmed]);
                if (r.out) { resolve(r.out); return; }
                resolve(null);
                return;
            }

            // If it looks like a full command, run it with /bin/sh -c
            const extraPath = this._settings?.get_string('extra-path')?.trim();
            const prefix = extraPath ? `PATH=${extraPath}:$PATH ` : '';
            const r = await runProc(['/bin/sh', '-c', `${prefix}${trimmed}`]);
            resolve(r.out ? r.out : null);
        });
    }

    async _update() {
        // 1) Prefer rivalcfg directly (user sets PATH globally)
    const foundPath = await this._resolveRivalcfgPath();
    const rcOut = await this._runRivalcfgOnce();
        if (rcOut) {
            log(`[kewu] rivalcfg output: ${rcOut}`);
            const parsed = this._parseScriptOutput(rcOut);
            if (parsed) {
                this._icon.icon_name = this._formatIconName(parsed.percent, parsed.charging);
                this._label.text = `${Math.round(parsed.percent)}%`;
                this._percentItem.label.text = `${_('Battery')}: ${Math.round(parsed.percent)}% · ${this._stateToText(parsed.state)}`;
                this.accessible_name = `${_('Battery Indicator')}: ${Math.round(parsed.percent)}%`;
                if (this._scriptDiagItem)
                    this._scriptDiagItem.label.text = `${_('Rivalcfg')}: ${Math.round(parsed.percent)}% · ${this._stateToText(parsed.state)}`;
                return;
            } else {
                if (this._scriptDiagItem) {
                    const shown = rcOut.length > 80 ? rcOut.slice(0, 80) + '…' : rcOut;
                    this._scriptDiagItem.label.text = `${_('Rivalcfg')}: ${_('Unrecognized')} → ${shown}`;
                }
            }
        } else {
            if (this._scriptDiagItem) {
                const suffix = foundPath ? `${_('found at')} ${foundPath}` : _('not found in PATH');
                this._scriptDiagItem.label.text = `${_('Rivalcfg')}: ${_('No output')} (${suffix})`;
            }
        }

        // 2) Fallback: user-provided script path (legacy)
        const scriptPath = this._settings?.get_string('script-path');
        if (scriptPath) {
            const out = await this._runScriptOnce(scriptPath);
            if (out)
                log(`[kewu] script output: ${out}`);
            const parsed = out ? this._parseScriptOutput(out) : null;
            if (parsed) {
                this._icon.icon_name = this._formatIconName(parsed.percent, parsed.charging);
                this._label.text = `${Math.round(parsed.percent)}%`;
                this._percentItem.label.text = `${_('Battery')}: ${Math.round(parsed.percent)}% · ${this._stateToText(parsed.state)}`;
                this.accessible_name = `${_('Battery Indicator')}: ${Math.round(parsed.percent)}%`;
                if (this._scriptDiagItem)
                    this._scriptDiagItem.label.text = `${_('Script')}: ${Math.round(parsed.percent)}% · ${this._stateToText(parsed.state)}`;
                return;
            }
            if (out && !parsed) {
                this._percentItem.label.text = _('Script output not recognized');
                if (this._scriptDiagItem) {
                    const shown = out.length > 80 ? out.slice(0, 80) + '…' : out;
                    this._scriptDiagItem.label.text = `${_('Script')}: ${_('Unrecognized')} → ${shown}`;
                }
            } else if (!out) {
                if (this._scriptDiagItem)
                    this._scriptDiagItem.label.text = `${_('Script')}: ${_('No output')}`;
            }
        }

        // 2) Fallback to UPower
        if (!this._device || !this._device.is_present) {
            this._icon.icon_name = 'battery-missing-symbolic';
            this._label.text = '--%';
            this._percentItem.label.text = _('No battery detected');
            return;
        }

        const percent = this._device.percentage;
        const state = this._device.state;
        const charging = state === UPowerGlib.DeviceState.CHARGING || state === UPowerGlib.DeviceState.PENDING_CHARGE;

        this._icon.icon_name = this._formatIconName(percent, charging);
        this._label.text = `${Math.round(percent)}%`;
        this._percentItem.label.text = `${_('Battery')}: ${Math.round(percent)}% · ${this._stateToText(state)}`;
        this.accessible_name = `${_('Battery Indicator')}: ${Math.round(percent)}%`;
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
        if (this._device && this._signalIds?.length) {
            for (const id of this._signalIds)
                this._device.disconnect(id);
            this._signalIds = [];
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
