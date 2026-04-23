[private]
@default:
    just --list

# Package the extension
pack:
    mkdir -p dist/
    gnome-extensions pack --force --extra-source ../LICENSE --out-dir dist/ src/

# Package and run the extension in a nested shell
debug: pack
    gnome-extensions install --force dist/bilingual-app-search@pwa.lu.shell-extension.zip

    # The following command requires the `mutter-devkit` binary. If not present,
    # it might give an error, or no error but the nested shell will just not
    # appear.
    dbus-run-session -- gnome-shell --devkit

# Package and upload the extension to EGO
upload: pack
    # Ensure that all changes have been committed
    test -z "$(git status --porcelain src/)"
    gnome-extensions upload --accept-tos dist/bilingual-app-search@pwa.lu.shell-extension.zip
