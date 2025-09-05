/* prefs.js - Preferences dialog for kewu extension */
/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KewuPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.kewu');

        const page = new Adw.PreferencesPage({ title: _('Battery Indicator') });

        // Script path
        const groupGeneral = new Adw.PreferencesGroup({ title: _('General') });
        const rowScript = new Adw.ActionRow({
            title: _('Script path (optional)'),
            subtitle: _('Optional fallback. The extension first tries “rivalcfg --battery-level” via PATH.'),
        });
        const entry = new Gtk.Entry({ hexpand: true });
        entry.text = settings.get_string('script-path');
        entry.placeholder_text = '/home/you/battery.sh';
        entry.connect('changed', w => settings.set_string('script-path', w.text));
        rowScript.add_suffix(entry);
        rowScript.activatable_widget = entry;
        groupGeneral.add(rowScript);

        // Extra PATH
        const rowPath = new Adw.ActionRow({
            title: _('Extra PATH'),
            subtitle: _('Colon-separated directories to prepend when running commands (e.g., /home/you/venv/bin)'),
        });
        const entryPath = new Gtk.Entry({ hexpand: true });
        entryPath.text = settings.get_string('extra-path');
        entryPath.placeholder_text = '/home/kewu/rivalcfg/rivalcfg.env/bin';
        entryPath.connect('changed', w => settings.set_string('extra-path', w.text));
        rowPath.add_suffix(entryPath);
        rowPath.activatable_widget = entryPath;
        groupGeneral.add(rowPath);
        // Refresh interval
        const rowRefresh = new Adw.ActionRow({
            title: _('Refresh seconds'),
            subtitle: _('How often to poll the script when set'),
        });
        const adj = new Gtk.Adjustment({
            lower: 5,
            upper: 3600,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('refresh-seconds'),
        });
        const spin = new Gtk.SpinButton({ adjustment: adj, numeric: true, climb_rate: 1 });
        spin.connect('value-changed', w => settings.set_int('refresh-seconds', w.get_value_as_int()));
        rowRefresh.add_suffix(spin);
        rowRefresh.activatable_widget = spin;
        groupGeneral.add(rowRefresh);

        page.add(groupGeneral);
        window.add(page);
    }
}
