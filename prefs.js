/* prefs.js - Preferences dialog for kewu extension */
/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KewuPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.kewu');

        const page = new Adw.PreferencesPage({ title: _('Battery Indicator') });

        // General
        const groupGeneral = new Adw.PreferencesGroup({ title: _('General') });
        // Refresh interval
        const rowRefresh = new Adw.ActionRow({
            title: _('Refresh seconds'),
            subtitle: _('How often to poll rivalcfg'),
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
