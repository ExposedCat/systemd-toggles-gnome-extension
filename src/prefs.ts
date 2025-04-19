import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';

export type SettingsWindow = Adw.PreferencesWindow & {
	_settings: Gio.Settings;
};

export type BuildNumberRowArgs = {
	settings: Gio.Settings;
	row: Adw.SpinRow;
	key: string;
	maxRow?: Adw.SpinRow | null;
	maxKey?: string;
	range?: [number, number, number];
};

export default class PreferencesManager extends ExtensionPreferences {
	private checkServiceExists(serviceName: string, isUserService: boolean): Promise<boolean> {
		const args = ['systemctl'];
		if (isUserService) {
			args.push('--user');
		}
		args.push('status', `${serviceName}.service`);

		return new Promise(resolve => {
			try {
				const proc = Gio.Subprocess.new(
					args,
					Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
				);

				proc.wait_async(null, (proc, result) => {
					try {
						proc!.wait_finish(result);
						const exitStatus = proc!.get_exit_status();
						resolve(exitStatus === 0 || exitStatus === 3);
					} catch (e) {
						resolve(false);
					}
				});
			} catch (e) {
				resolve(false);
			}
		});
	}

	fillPreferencesWindow(window: SettingsWindow) {
		const settings = this.getSettings();
		window._settings = settings;

		const page = new Adw.PreferencesPage();
		const serviceGroup = new Adw.PreferencesGroup({ title: 'Services' });
		const addServiceGroup = new Adw.PreferencesGroup({ title: 'Add Service' });

		const serviceListModel = settings.get_strv('service-list');
		const serviceListStore = new Gtk.StringList();
		serviceListModel.forEach(service => serviceListStore.append(service));

		const serviceListBox = new Gtk.ListBox({
			selection_mode: Gtk.SelectionMode.NONE,
			css_classes: ['boxed-list']
		});

		const serviceRows: Map<string, Adw.ActionRow> = new Map();
		const updateRowMap = new Map<Adw.ActionRow, number>();

		// Service add form
		const addServiceNameRow = new Adw.EntryRow({ title: 'Service Name' });
		const displayNameRow = new Adw.EntryRow({ title: 'Display Name (optional)' });
		const userServiceRow = new Adw.SwitchRow({ title: 'User Service' });

		const addButtonBox = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 5,
			margin_top: 10,
			halign: Gtk.Align.END,
			hexpand: true,
		});

		const addButton = new Gtk.Button({
			label: 'Add Service',
			css_classes: ['suggested-action'],
		});

		addButtonBox.append(addButton);

		const updateServices = () => {
			const services: string[] = [];
			for (let i = 0; i < serviceListStore.get_n_items(); i++) {
				const item = serviceListStore.get_string(i);
				if (!item) continue;
				services.push(item);
			}
			settings.set_strv('service-list', services);
		};

		const updateIndices = () => {
			let newIndex = 0;
			for (let i = 0; serviceListBox.get_row_at_index(i) !== null; i++) {
				const child = serviceListBox.get_row_at_index(i);
				if (child instanceof Adw.ActionRow) {
					updateRowMap.set(child, newIndex++);
				}
			}
		};

		for (let i = 0; i < serviceListStore.get_n_items(); i++) {
			const item = serviceListStore.get_string(i);
			if (!item) continue;

			const isUserService = item.startsWith('user:');
			let serviceName: string;
			let displayName: string;

			if (isUserService) {
				// Format: "user:serviceName:displayName" or legacy "user:serviceName"
				const parts = item.substring(5).split(':', 2);
				serviceName = parts[0];
				displayName = parts.length > 1 ? parts[1] : serviceName;
			} else {
				// Format: "serviceName:displayName" or legacy "serviceName"
				const parts = item.split(':', 2);
				serviceName = parts[0];
				displayName = parts.length > 1 ? parts[1] : serviceName;
			}

			const row = new Adw.ActionRow({ title: displayName });
			if (isUserService) {
				row.set_subtitle(displayName !== serviceName ?
					`User Service (${serviceName})` :
					"User Service");
			} else if (displayName !== serviceName) {
				row.set_subtitle(serviceName);
			}

			serviceRows.set(item, row);
			updateRowMap.set(row, i);

			const removeButton = new Gtk.Button({
				icon_name: 'user-trash-symbolic',
				valign: Gtk.Align.CENTER,
			});

			removeButton.connect('clicked', () => {
				const index = updateRowMap.get(row);
				if (index !== undefined) {
					serviceListStore.remove(index);
					serviceListBox.remove(row);
					serviceRows.delete(item);
					updateRowMap.delete(row);

					updateIndices();
					updateServices();
				}
			});

			row.add_suffix(removeButton);
			serviceListBox.append(row);
		}

		addButton.connect('clicked', async () => {
			const serviceName = addServiceNameRow.get_text();
			if (!serviceName) return;

			const isUserService = userServiceRow.active;
			const displayName = displayNameRow.get_text();

			const exists = await this.checkServiceExists(serviceName, isUserService);
			if (!exists) {
				const dialog = new Adw.MessageDialog({
					heading: "Service Not Found",
					body: `The ${isUserService ? "user " : ""}service "${serviceName}" does not exist`,
					transient_for: window,
					modal: true,
				});
				dialog.add_response("ok", "OK");
				dialog.present();
				return;
			}

			let formattedServiceName: string;
			if (isUserService) {
				formattedServiceName = displayName ?
					`user:${serviceName}:${displayName}` :
					`user:${serviceName}`;
			} else {
				formattedServiceName = displayName ?
					`${serviceName}:${displayName}` :
					serviceName;
			}

			serviceListStore.append(formattedServiceName);
			const newIndex = serviceListStore.get_n_items() - 1;

			const showName = displayName || serviceName;
			const row = new Adw.ActionRow({ title: showName });
			if (isUserService) {
				row.set_subtitle(displayName !== serviceName ?
					`User Service (${serviceName})` :
					"User Service");
			} else if (displayName !== serviceName) {
				row.set_subtitle(serviceName);
			}
			serviceRows.set(formattedServiceName, row);
			updateRowMap.set(row, newIndex);

			const removeButton = new Gtk.Button({
				icon_name: 'user-trash-symbolic',
				valign: Gtk.Align.CENTER,
			});

			removeButton.connect('clicked', () => {
				const index = updateRowMap.get(row);
				if (index !== undefined) {
					serviceListStore.remove(index);
					serviceListBox.remove(row);
					serviceRows.delete(formattedServiceName);
					updateRowMap.delete(row);

					updateIndices();
					updateServices();
				}
			});

			row.add_suffix(removeButton);
			serviceListBox.append(row);

			addServiceNameRow.set_text('');
			displayNameRow.set_text('');
			userServiceRow.active = false;
			updateServices();
		});

		serviceGroup.add(serviceListBox);
		page.add(serviceGroup);

		// Add service group
		const addServiceBox = new Gtk.ListBox({
			selection_mode: Gtk.SelectionMode.NONE,
			css_classes: ['boxed-list']
		});

		addServiceBox.append(addServiceNameRow);
		addServiceBox.append(displayNameRow);
		addServiceBox.append(userServiceRow);

		addServiceGroup.add(addServiceBox);
		addServiceGroup.add(addButtonBox);

		page.add(addServiceGroup);
		window.add(page);
	}

	bindStringRow(settings: Gio.Settings, row: Adw.EntryRow, key: string) {
		settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
	}

	bindNumberRow(args: BuildNumberRowArgs) {
		const { row, range = [0, 500, 1], settings, key, maxKey, maxRow } = args;
		row.adjustment = new Gtk.Adjustment({
			lower: range[0],
			upper: range[1],
			step_increment: range[2],
		});
		row.value = settings.get_int(key);
		row.connect('notify::value', spin => {
			const newValue = spin.get_value();
			settings.set_int(key, newValue);
			if (maxKey) {
				const maxValue = settings.get_int(maxKey);
				if (maxValue < newValue) {
					settings.set_int(maxKey, newValue);
					if (maxRow) {
						maxRow.value = newValue;
					}
				}
			}
		});
	}
}
