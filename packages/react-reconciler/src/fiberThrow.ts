import { Wakeable } from 'shared/ReactTypes';
import { FiberRootNode } from './fiber';
import { Lane, markRootpinged } from './fiberLanes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';
import { getSuspenseHandler } from './suspenseContext';
import { ShouldCapture } from './fiberFlags';

// 对两种情况的处理
// 1.render阶段抛出错误
// 2.render阶段挂起抛出promise
export function throwException(root: FiberRootNode, value: any, lane: Lane) {
	// Error Boundray

	// thenable
	if (
		value !== null &&
		typeof value === 'object' &&
		typeof value.then === 'function'
	) {
		const wakeable = value as Wakeable<any>;
		// 获取距离抛出promise节点最近的Suspense对应的Fiber，为其打上挂起的标志
		const suspenseBoundary = getSuspenseHandler();
		if (suspenseBoundary) {
			suspenseBoundary.flags |= ShouldCapture;
		}
		// 对应promise进行监听
		attachPingListener(root, wakeable, lane);
	}
}

function attachPingListener(
	root: FiberRootNode,
	wakeable: Wakeable<any>,
	lane: Lane
) {
	let pingCache = root.pingCache;
	let threadIDs: Set<Lane> | undefined;
	if (pingCache === null) {
		threadIDs = new Set<Lane>();
		pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
		pingCache.set(wakeable, threadIDs);
	} else {
		threadIDs = pingCache.get(wakeable);
		if (threadIDs === undefined) {
			threadIDs = new Set<Lane>();
			pingCache.set(wakeable, threadIDs);
		}
	}

	if (!threadIDs.has(lane)) {
		threadIDs.add(lane);
		function ping() {
			if (pingCache !== null) {
				pingCache.delete(wakeable);
			}
			markRootpinged(root, lane);
			markRootUpdated(root, lane);
			ensureRootIsScheduled(root);
		}

		// 当promise状态改变得到结果后，重新调度更新
		wakeable.then(ping, ping);
	}
}
