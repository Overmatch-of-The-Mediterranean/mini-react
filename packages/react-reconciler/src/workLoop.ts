import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitHookEffectListUpdate,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects,
	createWorkInProgress
} from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
	Lane,
	NoLane,
	SyncLane,
	getHignesPriorityLane,
	markRootFinished
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_NormalPriority as NormalPriority,
	unstable_scheduleCallback as scheduleCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';

// 指向正在工作的fiberNode。类似Vue中的activeEffect吗
let workInProgress: FiberNode | null = null;

// 当前正在调度的优先级
let wipRootRenderLane = NoLane;

// 代表该FC是否有useEffect对应的副作用在执行
let rootDoesHasPassiveEffects = false;

// 初始化指向根节点
export const prepareFreshStack = (root: FiberRootNode, lane: Lane) => {
	// 传入FiberRootNode的current，也就是当前正在显示的UI对应的HostRootFiber
	workInProgress = createWorkInProgress(root.current, {});
	wipRootRenderLane = lane;
};

export const scheduleUpdateOnFiber = (fiber: FiberNode, lane: Lane) => {
	// react的更新流程是从根开始向下更新的，所以无论那个FiberNode都要向上找到其根对应的FiberNode，也就是HostRootFiber
	const root = markUpdateFromFiberToRoot(fiber);

	// 收集该update任务对应的lane
	markRootUpdated(root, lane);

	// 传入 wip HostRootFiber，开始reconciler流程
	// 此函数便是scheduleUpdateOnFiber有调度更新作用的关键函数
	ensureRootIsScheduled(root);
};

// 确保根被调度更新
function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取优先级最高的update对应的优先数
	const updateLane = getHignesPriorityLane(root.pendingLanes);

	if (updateLane === NoFlags) {
		return;
	}

	if (updateLane === SyncLane) {
		if (__DEV__) {
			console.warn('在微任务中调度，优先级', updateLane);
		}
		// 同步任务，用微任务调度
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他任务，用宏任务调度
	}
}

// 收集update任务对应的lane
export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = root.pendingLanes | lane;
}

// 无论从哪个fiberNode开始调度更新，都会向上找到其HostRootFiber
export const markUpdateFromFiberToRoot = (fiber: FiberNode) => {
	let node = fiber;
	let parent = node.return;

	while (parent !== null) {
		node = parent;
		parent = node.return;
	}
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
};

// reconciler工作流程
// renderRoot -> performSyncWorkOnRoot,就是render阶段的入口
function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHignesPriorityLane(root.pendingLanes);

	if (nextLane !== SyncLane) {
		// 其他比SyncLane低的优先级或者时NoLane
		ensureRootIsScheduled(root);
		return;
	}

	if (__DEV__) {
		console.warn('render阶段开始');
	}

	// 初始化workInProgress
	prepareFreshStack(root, lane);

	do {
		try {
			workLoop();
			break;
		} catch (error) {
			if (__DEV__) {
				console.warn('workLoop发生错误', error);
			}
			workInProgress = null;
		}
	} while (true);

	// finishedWork用来存储 经reconciler构建好的wip Fiber tree的HostRootFiber
	const finishedWork = root.current.alternate;
	root.finishedWork = finishedWork;
	root.finishedLane = lane;
	wipRootRenderLane = NoLane;
	// renderer
	commitRoot(root);
}

// 开始commit(renderer)，
function commitRoot(root: FiberRootNode) {
	// 拿到wip Fiber tree的HostRootFiber
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('开始commit阶段', finishedWork);
	}

	const lane = root.finishedLane;

	if (lane === NoLane && __DEV__) {
		console.warn('commit阶段finishedLane不应该是NoLane');
	}

	// 重置，这两个值已经被保存下来了，所以可以重置
	root.finishedWork = null;
	root.finishedLane = NoLane;

	markRootFinished(root, lane);

	// 代表本次FC对应的Fiber tree中有effect hook(useEffect, useLayoutEffect)对应的副作用需要调度执行
	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subTreeFlags & PassiveMask) !== NoFlags
	) {
		if (!rootDoesHasPassiveEffects) {
			rootDoesHasPassiveEffects = true;
			// 调度副作用，可以看作在setTimeout中调度执行副作用
			scheduleCallback(NormalPriority, () => {
				// 执行副作用
				flushPassiveEffects(root.PendingPassiveEffects);
				return;
			});
		}
	}

	// 判断是否有需要执行对应DOM操作的flags
	const subTreeHasEffect =
		(finishedWork.subTreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

	// 代表新生成的wip Fiber tree中有需要进行操作的Flags标记
	if (subTreeHasEffect || rootHasEffect) {
		// 有，则按照标记执行不同的阶段
		// beforeMutation
		// Mutation
		commitMutationEffects(finishedWork, root);

		// 至此已经完成wip Fiber tree的渲染，切换current的指向
		root.current = finishedWork;
		// layout
	} else {
		root.current = finishedWork;
	}
	rootDoesHasPassiveEffects = false;

	// commit结束后，就要执行useEffect中的异步回调了
	ensureRootIsScheduled(root);
}

// commit结束后，调用useEffect异步回调
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	// 在组件卸载时，立即执行其内部useState的destroy函数
	pendingPassiveEffects.unmount.forEach((effect) => {
		commitHookEffectListUnmount(Passive, effect);
	});

	pendingPassiveEffects.unmount = [];

	// 在本次更新执行create函数前，将上次的destroy函数执行完毕
	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});

	// 执行本次更新的create函数
	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListUpdate(Passive | HookHasEffect, effect);
	});

	pendingPassiveEffects.update = [];

	// 执行回调过程中也可能触发更新，如在副作用中调用dispatch，所以需要调用一次flushSyncCallbacks
	flushSyncCallbacks();
}
function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

// 对每个工作单元(FiberNode)执行beginWork和compeleteWork
function performUnitOfWork(fiber: FiberNode) {
	// beginWork根据当期FiberNode创建下一级FiberNode
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;

	if (next === null) {
		// DFS到底了，开始归的过程
		completeUnitOfWork(fiber);
	} else {
		// 继续向下递的过程
		workInProgress = next;
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;

	do {
		// mount流程创建每个Fiber的DOM元素，并将其连接起来构成DOM树
		// update流程，标记Update
		// 最后进行Flags冒泡
		completeWork(node);

		// 对兄弟节点的处理
		const sibling = node.sibling;

		if (sibling !== null) {
			// 如果存在兄弟节点，则赋值wip，并回到wookLoop，对兄弟节点进行完整的reconciler流程
			workInProgress = sibling;
			return;
		}
		// 不存在兄弟节点则，向上归，对父元素进行completeWork
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
