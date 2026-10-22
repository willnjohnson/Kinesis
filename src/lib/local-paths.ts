import { convertFileSrc } from '@tauri-apps/api/core';

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;   // C:\Users\me\a.png or C:/Users/me/a.png
const UNC_PATH = /^\\\\/;                  // \\server\share\a.png
const POSIX_PATH = /^\/(?!\/)/;            // /home/me/a.png, /Users/me/a.png (Linux and macOS)

/** An image address that is a path on this computer, as a URL the webview can load (Tauri's asset
 *  protocol). `null` when it isn't a local path, so the normal handling applies. */
export function localPathToSrc(raw: string): string | null {
    let p = raw.trim();
    if (/^file:\/\//i.test(p)) {
        p = decodeURIComponent(p.replace(/^file:\/\/(localhost)?/i, ''));
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // file:///C:/x -> C:/x
    }
    if (WINDOWS_PATH.test(p) || UNC_PATH.test(p) || POSIX_PATH.test(p)) {
        return convertFileSrc(p);
    }
    return null;
}

/** Whether an image `src` is one of this computer's files, after localPathToSrc has turned it into Tauri's asset URL
 *  (http://asset.localhost/... on Windows, asset://localhost/... on macOS and Linux). By the time a component's `img`
 *  sees `src`, markdownUrlTransform has already run, so the original path is gone and only this form is left. */
export function isLocalSrc(src: string | undefined): boolean {
    return !!src && /^(asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/i.test(src);
}