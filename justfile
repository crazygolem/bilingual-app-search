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
    dbus-run-session -- gnome-shell --nested --wayland
