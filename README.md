A GNOME extension to make GNOME Search look up applications using their default locale (usually English) in addition to your configured system locale.

This is basically a workaround until the GNOME issue [#443 (Search for applications in both English and local language.)](https://gitlab.gnome.org/GNOME/glib/-/issues/443) gets finally resolved.

**Is this extension for you?**

*As a user with a non-English locale configured for your system*, if you like sometimes to search in English ("Files" instead of "Fichiers") or use applications' actual name ("Bottles" instead of "Bouteilles"), you might find this extension useful.

GNOME application authors and/or packagers have a tendency to use overly generic application names (e.g. "Files" instead of "Nautilus") and to eagerly translate non-generic application names (e.g. "Bouteilles" as the French localization for "Bottles").

It will especially help for applications installed as Flatpak, as in that case GNOME Search's algorithm doesn't return anything from the Desktop file's `Exec` line, which usually contains the untranslated, specific application name ("nautilus", "bottles").

**When should this extension not be used?**

This extension is basically not compatible with any other extension that customizes GNOME Search's applications result list.
The reason for this is that this part of the dashboard is not extensible, and must therefore be monkey-patched; there is currently no framework for extensions to collaborate on this part.

If you system's locale is configured to English, you might also not get much out of this extension as application authors and packagers tend to use English as the default locale.

If you're unhappy with other aspects of GNOME Search's algorithm this extension might not scratch your itch, as it attempts to match GNOME Search's algorithm as closely as possible, only taking into account an extra locale.

## Install

TODO

## How it works

This extension lifts upstream GNOME Search's code related to the application result list, and changes the part that searches through your applications to use a custom function.
The lifted and customized code then replaces the original code when the extension is enabled (and reverts the change when disabled).

The custom search function reimplements upstream GLib's search function, which is used by the original GNOME Search code, but looks up search terms in both the localized and default keys of applications' Desktop file, where GLib's search function uses only the localized keys.

## FAQ

**Can this extension handle extra/configurable locales?**

Unfortunately **no**, not with the current approach relying on the standard libraries for GNOME extensions: they don't provide a way to select the locale to use when looking up keys in Desktop files, the only options are localized (as in: the user's current locale) and default (keys without locale in the Desktop file) lookups.
The underlying C functions from GLib allow to select the locale, but not the Javascript wrappers in the Gio library used by this extension.
