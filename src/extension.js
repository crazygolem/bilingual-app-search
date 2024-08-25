import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import Gio from 'gi://Gio'
import Shell from 'gi://Shell'
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js'
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js'
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js'


class Index {
    #monitorHandlerId
    #metas = []
    #needsRefresh = true

    constructor() {
        this.#monitorHandlerId = Gio.AppInfoMonitor.get()
            .connect('changed', () => { this.#needsRefresh = true })
    }

    destroy() {
        Gio.AppInfoMonitor.get().disconnect(this.#monitorHandlerId)
        this.#monitorHandlerId = null
        this.#metas = null
    }

    getAll() {
        if (this.#needsRefresh) {
            this.#refresh()
            this.#needsRefresh = false
        }

        return this.#metas
    }

    #refresh() {
        this.#metas = Gio.AppInfo.get_all()
            .filter(app => app.should_show())
            // Low-level access to the metadata uses methods from the
            // DesktopAppInfo interface, AppInfo is not sufficient. If it causes
            // issues, a fallback can be added in the future to handle other
            // AppInfo objects.
            .filter(app => app instanceof Gio.DesktopAppInfo)
            .flatMap(app => this.#toMeta(app))
            .filter(a => a.id != null)
    }

    #toMeta(appInfo) {
        return {
            id: appInfo.get_id(),

            name: [
                appInfo.get_string('Name'),
                appInfo.get_locale_string('Name'),
            ].filter(s => s).map(s => s.toLowerCase()),

            genericname: [
                appInfo.get_string('GenericName'),
                appInfo.get_locale_string('GenericName'),
            ].filter(s => s).map(s => s.toLowerCase()),

            fullname: [
                appInfo.get_string('X-GNOME-FullName'),
                appInfo.get_locale_string('X-GNOME-FullName'),
            ].filter(s => s).map(s => s.toLowerCase()),

            keywords: [
                ...(appInfo.get_string_list('Keywords') ?? []),
                ...(this.#get_locale_string_list(appInfo, 'Keywords') ?? []),
            ].filter(s => s).map(s => s.toLowerCase()),

            command: this.#extractCommand(appInfo.get_executable())?.toLowerCase(),
        }
    }

    // Common prefix commands to ignore from Exec= lines
    // cf. https://gitlab.gnome.org/GNOME/glib/-/blob/2.80.4/gio/gdesktopappinfo.c#L459-473
    static #exec_key_match_blocklist = new Set([
        "bash",
        "env",
        "flatpak",
        "gjs",
        "pkexec",
        "python",
        "python2",
        "python3",
        "sh",
        "wine",
        "wine64",
    ])

    // cf. https://gitlab.gnome.org/GNOME/glib/-/blob/2.80.4/gio/gdesktopappinfo.c#L1206-1223
    #extractCommand(exec) {
        let cmd = exec?.split(/\s/, 1)[0].split('/').pop()
        return Index.#exec_key_match_blocklist.has(cmd) ? null : cmd
    }

    // There is no _locale_ variant that fetches a list.
    // The separator might not always be a semicolon (the spec mentions the
    // comma), but I've not seen anything else being used so far.
    #get_locale_string_list(appInfo, key) {
        // Although the spec mentions that other separators are possible, I
        // can't figure out how the GLib/Gio code determines which separator is
        // used, and I suspect it doesn't; KeyFile.set_list_separator would need
        // to be called explicitly somewhere from the lib.
        let list = appInfo.get_locale_string(key)?.split(';')

        // Desktop files commonly have the separator character at the end of the
        // list, resulting in an extra empty string element. Removing that last
        // element is consistent with the behavior of get_string_list and
        // key_keywords.
        if (list?.[list.length - 1] === '') {
            list.pop()
        }

        return list
    }
}

export default class BilingualAppSearch extends Extension {
    #index
    #originalFn

    // Various objects needed for the `getInitialResultSet` code lifted from
    // upstream. They should get initialized in the same way as in upstream.
    #_appSys
    #_parentalControlsManager
    #_parentalControlsManagerInitializedIds
    #_systemActions

    enable() {
        this.#index = new Index()

        this.#_appSys = Shell.AppSystem.get_default()
        this.#_parentalControlsManagerInitializedIds = []
        this.#_parentalControlsManager = ParentalControlsManager.getDefault()
        this.#_systemActions = new SystemActions.getDefault()

        // AppSearchProvider is not extensible (i.e. plugins can't provide their
        // own app lists), so it must be monkey-patched. This will conflict with
        // other extensions that customize the app search functionality.
        this.#originalFn = AppDisplay.AppSearchProvider.prototype.getInitialResultSet
        AppDisplay.AppSearchProvider.prototype.getInitialResultSet = this.#getInitialResultSet.bind(this)
    }

    disable() {
        AppDisplay.AppSearchProvider.prototype.getInitialResultSet = this.#originalFn
        this.#originalFn = null

        this.#_systemActions = null
        this.#_parentalControlsManagerInitializedIds.forEach(
            handlerId => this.#_parentalControlsManager.disconnect(handlerId))
        this.#_parentalControlsManagerInitializedIds = null
        this.#_parentalControlsManager = null
        this.#_appSys = null

        this.#index.destroy()
        this.#index = null
    }

    // Lifted from AppDisplay.AppSearchProvider.prototype.getInitialResultSet,
    // the only changes are:
    // - how the `groups` variable gets populated
    // - bookkeeping to meet extra requirements for extensions
    // - uses local versions of various objects to be more robust against
    //   upstram changes
    //
    // cf. https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/46.3.1/js/ui/appDisplay.js#L1840-1870
    #getInitialResultSet(terms, cancellable) {
        // Defer until the parental controls manager is initialised, so the
        // results can be filtered correctly.
        if (!this.#_parentalControlsManager.initialized) {
            return new Promise(resolve => {
                let initializedId = this.#_parentalControlsManager.connect('app-filter-changed', async () => {
                    if (this.#_parentalControlsManager.initialized) {
                        this.#_parentalControlsManager.disconnect(initializedId);
                        resolve(await this.#getInitialResultSet(terms, cancellable));
                    }
                });
                this.#_parentalControlsManagerInitializedIds.push(initializedId);
            });
        }

        let groups = this.#search(terms);
        let usage = Shell.AppUsage.get_default();
        let results = [];

        groups.forEach(group => {
            group = group.filter(appID => {
                const app = this.#_appSys.lookup_app(appID);
                return app && this.#_parentalControlsManager.shouldShowApp(app.app_info);
            });
            results = results.concat(group.sort(
                (a, b) => usage.compare(a, b)));
        });

        results = results.concat(this.#_systemActions.getMatchingActions(terms));
        return new Promise(resolve => resolve(results));
    }

    // Adapted from the C code underpinning DesktopAppInfo.search. It had to be
    // reimplemented because I want to be as faithful as possible to the
    // upstream algorithm while adding support for extra languages, but the
    // upstream implementation cannot be extended and monkey-patching it seems
    // dangerous, if at all feasible.
    //
    // cf. desktop_file_dir_unindexed_setup_search
    // https://gitlab.gnome.org/GNOME/glib/-/blob/2.80.4/gio/gdesktopappinfo.c#L1165-1240
    #search(tokens) {
        tokens = tokens.map(t => t.toLowerCase())

        // Every token must match something, and only the best matching group is
        // returned.
        //
        // cf. desktop_key_match_category
        // https://gitlab.gnome.org/GNOME/glib/-/blob/2.80.4/gio/gdesktopappinfo.c#L436-447
        let match = (meta) => {
            return tokens
                .map(t => {
                    if (meta.name?.some(e => e.includes(t))) return 1
                    if (meta.command?.includes(t)) return 2
                    if (meta.keywords?.some(e => e.includes(t))) return 3
                    if (meta.genericname?.some(e => e.includes(t))) return 4
                    if (meta.fullname?.some(e => e.includes(t))) return 5
                    return 0
                })
                .reduce((acc, cur) => Math.min(acc, cur))
        }

        let res = []
        this.#index.getAll()
            .map(meta => ({id: meta.id, group: match(meta)}))
            .filter(({group}) => group > 0)
            .forEach(({id, group}) => (res[group - 1] = res[group - 1] ?? []).push(id))

        return res
    }
}
