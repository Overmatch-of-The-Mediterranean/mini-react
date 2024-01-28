import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitHookEffectListUpdate,
	commitLayoutEffects,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects,
	createWorkInProgress
} from './fiber';
import {
	HostEffectMask,
	MutationMask,
	NoFlags,
	PassiveMask
} from './fiberFlags';
import {
	Lane,
	NoLane,
	SyncLane,
	getHignesPriorityLane,
	getNextLane,
	lanesToSchedulerPriority,
	markRootFinished,
	markRootSuspended,
	mergeLanes
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_NormalPriority as NormalPriority,
	unstable_scheduleCallback as scheduleCallback,
	unstable_cancelCallback,
	unstable_scheduleCallback,
	unstable_shouldYield
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';
import { SuspenseException, getSuspenseThenable } from './thenable';
import { resetHooksOnUnwind } from './fiberHooks';
import { throwException } from './fiberThrow';
import { unwindWork } from './fiberUnwindWork';

// 指向正在工作的fiberNode。类似Vue中的activeEffect吗
let workInProgress: FiberNode | null = null;

// 当前正在调度的优先级
let wipRootRenderLane = NoLane;

// 代表该FC是否有useEffect对应的副作用在执行
let rootDoesHasPassiveEffects = false;

type ExitStatus = number;

//工作中的状态
const RootInProgress = 0;
// 并发更新中途打断
const RootInComplete = 1;
// render完成
const RootCompleted = 2;

const RootDidNotComplete = 3;

let wipRootExitStatus: number = RootInProgress;

type SuspendedReason = typeof NoSuspended | typeof SuspendedOnData;
const NoSuspended = 0;
const SuspendedOnData = 1;

let wipSuspendedReason: SuspendedReason = NoSuspended;

let wipThrownValue: any = null;

// 初始化指向根节点
export const prepareFreshStack = (root: FiberRootNode, lane: Lane) => {
	root.finishedLane = NoLane;
	root.finishedWork = null;
	// 传入FiberRootNode的current，也就是当前正在显示的UI对应的HostRootFiber

	workInProgress = createWorkInProgress(root.current, {});

	wipRootRenderLane = lane;

	wipThrownValue = null;
	wipSuspendedReason = NoSuspended;
	wipRootExitStatus = RootInProgress;
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
export function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取优先级最高的update对应的优先数
	const updateLane = getNextLane(root);
	let existingCallback = root.callbackNode;

	//策略逻辑
	if (updateLane === NoLane) {
		if (existingCallback !== null) {
			unstable_cancelCallback(existingCallback);
		}
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}
	// 还有update
	const currentPriority = updateLane;
	const prevPriority = root.callbackPriority;
	if (currentPriority === prevPriority) {
		return;
	}

	// 优先级更高
	if (existingCallback !== null) {
		unstable_cancelCallback(existingCallback);
	}

	if (__DEV__) {
		console.warn(
			`在${updateLane === SyncLane ? '微' : '宏'}任务中调度，优先级`,
			updateLane
		);
	}

	let newCallbackNode = null;

	if (updateLane === SyncLane) {
		// 同步任务，用微任务调度
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他任务，用宏任务调度
		const schedulerPriority = lanesToSchedulerPriority(updateLane);

		newCallbackNode = unstable_scheduleCallback(
			schedulerPriority,
			performConcurrentWorkOnRoot.bind(null, root)
		);
		root.callbackNode = newCallbackNode;
		root.callbackPriority = currentPriority;
	}
}

// 收集update任务对应的lane
export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
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

// 并发执行
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout?: boolean
): any {
	const curCallback = root.callbackNode;
	// 将useEffect的回调函数执行完，因为回调中可能触发更高优先级更新
	const didFlushPassiveEffect = flushPassiveEffects(root.PendingPassiveEffects);

	if (didFlushPassiveEffect) {
		if (root.callbackNode !== curCallback) {
			return null;
		}
	}

	const lane = getNextLane(root);
	const curCallbackNode = root.callbackNode;
	if (lane === NoLane) {
		return null;
	}

	const needSync = lane === SyncLane || didTimeout;

	const exitStatus = rootRender(root, lane, !needSync);

	switch (exitStatus) {
		case RootInComplete:
			if (root.callbackNode !== curCallbackNode) {
				return null;
			}

			return performConcurrentWorkOnRoot.bind(null, root);
		case RootCompleted:
			// finishedWork用来存储 经reconciler构建好的wip Fiber tree的HostRootFiber
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			root.finishedLane = lane;
			wipRootRenderLane = NoLane;
			// renderer
			commitRoot(root);
			// return;
			break;
		case RootDidNotComplete:
			wipRootRenderLane = NoLane;
			markRootSuspended(root, lane);
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.warn('还未处理的并发更新终止状态');
			}
			break;
	}
}

// 同步流程
function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getNextLane(root);

	if (nextLane !== SyncLane) {
		// 其他比SyncLane低的优先级或者NoLane时
		ensureRootIsScheduled(root);
		return;
	}
	const exitStatus = rootRender(root, nextLane, false);

	switch (exitStatus) {
		case RootCompleted:
			// finishedWork用来存储 经reconciler构建好的wip Fiber tree的HostRootFiber
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			root.finishedLane = nextLane;
			wipRootRenderLane = NoLane;
			// renderer
			commitRoot(root);
			break;
		case RootDidNotComplete:
			wipRootRenderLane = NoLane;
			markRootSuspended(root, nextLane);
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.warn('还未处理的同步更新终止状态');
			}
			break;
	}
}

function rootRender(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		console.log(`开启${shouldTimeSlice ? '并发' : '同步'}更新`);
	}

	if (wipRootRenderLane !== lane) {
		// 初始化workInProgress
		prepareFreshStack(root, lane);
	}

	do {
		try {
			if (wipSuspendedReason !== NoSuspended && workInProgress !== null) {
				// 对suspense的fiber挂起时的处理
				const thrownValue = wipThrownValue;
				wipSuspendedReason = NoSuspended;
				wipThrownValue = null;
				throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
			}

			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (error) {
			if (__DEV__) {
				// debugger;
				console.warn('workLoop发生错误', error);
			}
			handleThrow(root, error);
		}
	} while (true);

	if (wipRootExitStatus !== RootInProgress) {
		return wipRootExitStatus;
	}

	// 中断或执行完成
	if (shouldTimeSlice && workInProgress !== null) {
		// 有时间片且wip不为null，说明是时间片用尽中断
		return RootInComplete;
	}

	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		return console.error('rootRender未处理的更新状态');
	}

	// 完成
	return RootCompleted;
}

function throwAndUnwindWorkLoop(
	root: FiberRootNode,
	unitOfWork: FiberNode,
	thrownValue: any,
	lane: Lane
) {
	// 重置FC全局变量
	resetHooksOnUnwind(unitOfWork);
	// 请求返回后重新触发更新
	throwException(root, thrownValue, lane);
	// unwind
	unwindUnitOfWork(unitOfWork);
}

// 从当前抛出Promise的节点开始处理，向上遍历找到距离该节点最近的Suspense组件对应的Fiber
function unwindUnitOfWork(unitOfWork: FiberNode) {
	let inCompleteWork: FiberNode | null = unitOfWork;

	do {
		const next = unwindWork(inCompleteWork); // 判断是否是Suspense组件对应的Fiber
		if (next !== null) {
			next.flags &= HostEffectMask;
			// 找到距离该节点最近的Suspense组件对应的Fiber，由该节点开始向下的beginWork
			workInProgress = next;
			return;
		}

		// 向上查找
		const returnFiber = inCompleteWork.return as FiberNode;
		// 将沿途fiber中要删除的节点清空，因为需要重新进行beginWork
		if (returnFiber !== null) {
			returnFiber.deletions = null;
		}

		inCompleteWork = returnFiber;
	} while (inCompleteWork !== null);

	// debugger;
	workInProgress = null;
	wipRootExitStatus = RootDidNotComplete;
	// workInProgress = null;
	// TODO
}

// 1.对于suspense抛出的错误，则赋值挂起原因以及promise
// 2.对于错误的处理 // TODO
function handleThrow(root: FiberRootNode, thrownValue: any) {
	if (thrownValue === SuspenseException) {
		// 对于render阶段挂起的处理，获取抛出的promise
		thrownValue = getSuspenseThenable();
		// 标记挂起原因
		wipSuspendedReason = SuspendedOnData;
	} else {
		// TODO
	}
	// 赋值抛出的错误或promise
	wipThrownValue = thrownValue;
}

// 开始commit(renderer)，
function commitRoot(root: FiberRootNode) {
	// 拿到wip Fiber tree的HostRootFiber
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}
	// debugger;
	if (__DEV__) {
		console.warn('开始commit阶段', finishedWork);
	}

	const lane = root.finishedLane;

	console.log('finishedWork', finishedWork);

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
		(finishedWork.subTreeFlags & (MutationMask | PassiveMask)) !== NoFlags;
	const rootHasEffect =
		(finishedWork.flags & (MutationMask | PassiveMask)) !== NoFlags;

	// 代表新生成的wip Fiber tree中有需要进行操作的Flags标记
	if (subTreeHasEffect || rootHasEffect) {
		// 有，则按照标记执行不同的阶段
		// beforeMutation
		// Mutation
		commitMutationEffects(finishedWork, root);

		// 至此已经完成wip Fiber tree的渲染，切换current的指向
		root.current = finishedWork;
		// layout
		commitLayoutEffects(finishedWork, root);
	} else {
		root.current = finishedWork;
	}
	rootDoesHasPassiveEffects = false;
	// commit结束后，就要执行useEffect中的异步回调了
	ensureRootIsScheduled(root);
}

// commit结束后，调用useEffect异步回调
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	let didFlushPassiveEffect = false;

	// 在组件卸载时，立即执行其内部useState的destroy函数
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});

	pendingPassiveEffects.unmount = [];

	// 在本次更新执行create函数前，将上次的destroy函数执行完毕
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});

	// 执行本次更新的create函数
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUpdate(Passive | HookHasEffect, effect);
	});

	pendingPassiveEffects.update = [];

	// 执行回调过程中也可能触发更新，如在副作用中调用dispatch，所以需要调用一次flushSyncCallbacks
	flushSyncCallbacks();

	return didFlushPassiveEffect;
}

// 并发更新
function workLoopConcurrent() {
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

// 同步更新
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

// 对每个工作单元(FiberNode)执行beginWork和compeleteWork
function performUnitOfWork(fiber: FiberNode) {
	// beginWork根据当期FiberNode创建下一级FiberNode
	const next = beginWork(fiber, wipRootRenderLane);
	// console.log('next', next);

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
