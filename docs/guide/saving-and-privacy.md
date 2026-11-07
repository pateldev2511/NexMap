# Saving, privacy and offline

## Where your work lives

NexMap keeps your work in two places, both on your own computer:

1. **Autosave in your browser.** About a second after every change, NexMap
   saves a draft in your browser's storage. If the tab closes, the computer
   restarts or the browser crashes, the next time you open NexMap it asks
   **Recover your work?**, showing what the draft holds and when it was saved.
2. **Files you save.** **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes a
   `.nexmap` file wherever you choose. **Open** (<kbd>Ctrl</kbd>+<kbd>O</kbd>)
   reads one back, on this computer or any other.

> [!IMPORTANT]
> Browser storage is convenient but not permanent: clearing your browsing data,
> or using a private window, removes it. **Save a file** for anything you want
> to keep.

### How Save behaves

- In **Chrome and Edge**, Save writes back to the same file each time, like a
  normal app.
- In **Firefox and Safari**, which don't allow that, each Save downloads a
  fresh copy of the file.

**More → Settings** shows which your browser supports.

### Unsaved changes are never thrown away silently

A dot next to the project name means there are changes not yet saved to a
file. If you start a **New** project or **Open** another while there are
unsaved changes, NexMap asks: **Save**, **Discard changes** or **Cancel**.

### Older files

NexMap always opens files from older versions and upgrades them; it tells you
when it does. A file from a *newer* version is refused rather than damaged.
A broken file is refused with an explanation, and your current project is
left untouched.

## Privacy

- **No account and no login.**
- **Nothing is uploaded.** NexMap has no server that stores projects. It
  even blocks itself from sending data to any other website.
- **No tracking or analytics** in the app.

If your browser blocks site storage entirely, NexMap still works: you can
open, edit and save files. Settings just won't be remembered between visits,
and NexMap tells you so.

## Working offline

After your **first visit**, NexMap copies itself into your browser so it can
run without an internet connection. When that's done, it shows **"NexMap is
ready to work offline."** From then on it opens and works fully offline,
in both designers and with every export.

When a new version comes out, you'll see **"A new version of NexMap is
available"** with a **Reload** button.

## Two tabs at once

If the same project is open in two tabs, only the first can edit it. The
second becomes **view-only** (you can look, copy and export, but not change
anything) so the two can't overwrite each other. Close the first tab and the
second takes over with the latest version.

## Starting fresh

**More → Settings → Clear all local data…** removes everything NexMap has
stored in this browser: drafts and settings. Files you saved are not affected.
