import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

type ServiceState = {
	name: string;
	displayName: string;
	isUserService: boolean;
	active: boolean;
}

export default class SystemdTogglesGnomeShellExtension extends Extension {
	_indicator: PanelMenu.Button | null = null;
	_services: ServiceState[] = [];
	_settings: Gio.Settings | null = null;
	_settingsChangedId: number | null = null;

	_getCustomIcon(iconName: string): Gio.Icon {
		const path = `${this.path}/icons/${iconName}.svg`;
		return Gio.FileIcon.new(Gio.File.new_for_path(path));
	}

	enable() {
		this._settings = this.getSettings();
		this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

		const icon = new St.Icon({
			gicon: this._getCustomIcon('systemd-green'),
			style_class: 'system-status-icon',
			icon_size: 36,
		});
		this._indicator.add_child(icon);

		const buildMenuWithServices = async () => {
			await this._loadServices();
			this._buildMenu();
		};

		buildMenuWithServices().then(() => {
			this._settingsChangedId = this._settings!.connect('changed::service-list', async () => {
				await this._loadServices();
				this._rebuildMenu();
			});

			(this._indicator!.menu as any).connect('open-state-changed', async (_: any, isOpen: boolean) => {
				if (isOpen) {
					await this._loadServices();
					this._rebuildMenu();
				}
			});
			Main.panel.addToStatusArea(this.metadata.uuid, this._indicator!);
		})
	}

	disable() {
		if (this._indicator) {
			this._indicator.destroy();
			this._indicator = null;
		}

		if (this._settings && this._settingsChangedId !== null) {
			this._settings.disconnect(this._settingsChangedId);
			this._settingsChangedId = null;
		}

		this._services = [];
		this._settings = null;
	}

	async _loadServices() {
		if (!this._settings) return;

		const serviceList = this._settings.get_strv('service-list');
		this._services = [];

		for (const serviceEntry of serviceList) {
			const isUserService = serviceEntry.startsWith('user:');

			let serviceName: string;
			let displayName: string;

			if (isUserService) {
				// Format: "user:serviceName:displayName" or legacy "user:serviceName"
				const parts = serviceEntry.substring(5).split(':', 2);
				serviceName = parts[0];
				displayName = parts.length > 1 ? parts[1] : serviceName;
			} else {
				// Format: "serviceName:displayName" or legacy "serviceName"
				const parts = serviceEntry.split(':', 2);
				serviceName = parts[0];
				displayName = parts.length > 1 ? parts[1] : serviceName;
			}

			const active = await this._checkServiceActive(serviceName, isUserService);

			this._services.push({
				name: serviceName,
				displayName,
				isUserService,
				active
			});
		}
	}

	_executeSystemdCommand(args: string[], errorMessage?: string): Promise<boolean> {
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
						resolve(exitStatus === 0);
					} catch (e) {
						if (errorMessage) {
							console.error(errorMessage, e);
						}
						resolve(false);
					}
				});
			} catch (e) {
				if (errorMessage) {
					console.error(errorMessage, e);
				}
				resolve(false);
			}
		});
	}

	async _checkServiceActive(serviceName: string, isUserService: boolean): Promise<boolean> {
		const args = ['systemctl'];
		if (isUserService) {
			args.push('--user');
		}
		args.push('is-active', `${serviceName}.service`);

		return await this._executeSystemdCommand(args);
	}

	async _toggleService(service: ServiceState, newState: boolean): Promise<boolean> {
		const action = newState ? 'start' : 'stop';
		const args = ['systemctl'];

		if (service.isUserService) {
			args.push('--user');
		}

		args.push(action, `${service.name}.service`);

		const messageText = `${newState ? 'Starting' : 'Stopping'} service ${service.name} failed`;
		const result = await this._executeSystemdCommand(args, messageText);

		if (result) {
			service.active = newState;
		}

		return result;
	}

	_rebuildMenu() {
		if (!this._indicator) return;
		(this._indicator!.menu as PopupMenu.PopupMenu).removeAll();
		this._buildMenu();
	}

	_buildMenu() {
		if (!this._indicator) return;
		this._services.sort((a, b) => a.name.localeCompare(b.name)).forEach(service => {
			const menuItem = new PopupMenu.PopupBaseMenuItem();

			// Use the service display name for the label
			const nameLabel = new St.Label({ text: service.displayName });
			menuItem.add_child(nameLabel);

			// Add an expanding spacer to push the toggle to the right
			const spacer = new St.Widget({
				style_class: 'popup-menu-item-expander',
				x_expand: true
			});
			menuItem.add_child(spacer);

			const toggle = new PopupMenu.Switch(service.active);

			toggle.connect('notify::state', async () => {
				const newState = toggle.state;

				toggle.reactive = false;

				const success = await this._toggleService(service, newState);
				if (!success) {
					toggle.state = service.active;

					Main.notify(
						`Failed to ${newState ? 'start' : 'stop'} ${service.name}`,
						"Check system logs for details"
					);
				}
				toggle.reactive = true;
			});

			menuItem.add_child(toggle);
			(this._indicator!.menu as PopupMenu.PopupMenu).addMenuItem(menuItem);
		});

		if (this._services.length === 0) {
			const emptyItem = new PopupMenu.PopupMenuItem('Add services to control via Extension Settings');
			emptyItem.sensitive = false;
			(this._indicator!.menu as PopupMenu.PopupMenu).addMenuItem(emptyItem);
		}

		// Add separator and settings button
		(this._indicator!.menu as PopupMenu.PopupMenu).addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		const settingsItem = new PopupMenu.PopupMenuItem('Settings');
		settingsItem.connect('activate', () => {
			this.openPreferences();
		});
		(this._indicator!.menu as PopupMenu.PopupMenu).addMenuItem(settingsItem);
	}
}
