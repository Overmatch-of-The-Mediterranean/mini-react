let syncQueue: ((...arg: any) => void)[] | null = null;

let isFlushingSyncQueue = false;

export function scheduleSyncCallback(callback: (...arg: any) => void) {
	if (syncQueue === null) {
		syncQueue = [callback];
	} else {
		syncQueue.push(callback);
	}
}

export function flushSyncCallbacks() {
	if (!isFlushingSyncQueue && syncQueue) {
		isFlushingSyncQueue = true;
		try {
			syncQueue.forEach((callback) => callback());
		} catch (error) {
			if (__DEV__) {
				console.error('flushSyncCallbacks出错');
			}
		} finally {
			isFlushingSyncQueue = false;
			syncQueue = null;
		}
	}
}
