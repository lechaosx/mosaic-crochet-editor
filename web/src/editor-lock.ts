// One window of the app at a time is the editor: it alone accepts edits and
// writes browser records. It holds a Web Lock until it unloads; another window
// takes over by stealing the lock, which the browser reports to the holder.

const LOCK = "mosaic-editor";

// Resolves once this window is the editor. While another window is, `offer`
// gets the action that takes over from it. `lost` runs when another window
// takes over from this one. Without Web Locks, or when the browser denies
// them, every window edits.
export function becomeEditor(offer: (takeOver: () => void) => void, lost: () => void): Promise<void> {
    if (!navigator.locks) return Promise.resolve();
    return new Promise(resolve => {
        let held = false;
        const hold = () => {
            held = true;
            resolve();
            return new Promise<never>(() => {});
        };
        const released = () => held ? lost() : resolve();
        navigator.locks.request(LOCK, { ifAvailable: true }, lock => {
            if (lock) return hold();
            offer(() => navigator.locks.request(LOCK, { steal: true }, hold).catch(released));
        }).catch(released);
    });
}
