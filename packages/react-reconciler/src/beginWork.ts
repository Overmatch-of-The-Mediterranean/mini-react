import { ReactElementType } from 'shared/ReactTypes';
import {
	FiberNode,
	OffscreenProps,
	createFiberFromFragment,
	createFiberFromOffscreen,
	createWorkInProgress
} from './fiber';
import { UpdateQueue, processUpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	OffscreenComponent,
	SuspenseComponent
} from './workTags';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';
import {
	ChildrenDeletion,
	DidCapture,
	NoFlags,
	Placement,
	Ref,
	Visibility
} from './fiberFlags';
import { pushProvider } from './fiberContext';
import { pushSuspenseHandler } from './suspenseContext';

// 递归的递阶段
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	console.log('beginWork', wip);

	// 根据Fiber的类型，进行不同的操作，最终根据当前FiberNode与ReactElement生成子FiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			return null;
		case FunctionComponent:
			return updateFunctionComponent(wip, wip.type, renderLane);
		case Fragment:
			return updateFragment(wip);
		case ContextProvider:
			return updateContextProvider(wip);
		case SuspenseComponent:
			return updateSuspenseComponent(wip);
		case OffscreenComponent:
			return updateOffscreenComponent(wip);
		default:
			if (__DEV__) {
				console.warn('begin未实现的类型');
			}
			break;
	}
	return null;
};

function updateSuspenseComponent(wip: FiberNode) {
	const current = wip.alternate;
	const newProps = wip.pendingProps;

	// 是否显示fallback
	let showFallback = false;

	// 是否挂起
	let didSuspend = (wip.flags & DidCapture) !== NoFlags;

	if (didSuspend) {
		// 挂起，则应该返回fallback的Fiber，同时清除DidCapture标志
		showFallback = true;
		wip.flags &= ~DidCapture;
	}
	// Suspense组件的children
	const nextPrimaryChildren = newProps.children;
	// Suspense组件的fallback属性
	const nextFallbackChildren = newProps.fallback;
	// 将Suspense对应的Fiber放入栈中，记录起来
	pushSuspenseHandler(wip);

	if (current === null) {
		// mount 首屏渲染
		if (showFallback) {
			// 挂起状态，展示fallback
			return mountSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 非挂起，展示children
			return mountSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	} else {
		// update 页面更新
		if (showFallback) {
			// 挂起状态，展示fallback
			return updateSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 非挂起状态，展示children

			// debugger;

			return updateSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	}
}

function mountSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	const primaryChildrenProps: OffscreenProps = {
		mode: 'visible',
		children: primaryChildren
	};

	const primaryChildFragment = createFiberFromOffscreen(primaryChildrenProps);

	primaryChildFragment.return = wip;
	wip.child = primaryChildFragment;

	return primaryChildFragment;
}

function mountSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const primaryChildrenProps: OffscreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};

	const primaryChildFragment = createFiberFromOffscreen(primaryChildrenProps);
	const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);

	// 因为此时Suspense已经挂载，所以需要自己打上标记
	fallbackChildFragment.flags |= Placement;

	// 保持suspense，primaryChildFragment，fallbackChildFragment之间的联系
	primaryChildFragment.return = wip;
	fallbackChildFragment.return = wip;
	primaryChildFragment.sibling = fallbackChildFragment;
	wip.child = primaryChildFragment;

	return fallbackChildFragment;
}

function updateSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	// 获取suspense对应的current fiber，及其current children和fallback的current fiber
	const current = wip.alternate as FiberNode;
	const currentPrimaryChildFragment: FiberNode = current.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sibling;

	// 显示Suspense组件的children
	const primaryChildProps: OffscreenProps = {
		mode: 'visible',
		children: primaryChildren
	};

	// 这里不需要提前对fallbackChildFragment进行处理，什么时候挂载它时，在对它处理。
	// updateSuspenseFallbackChildren中就是对于fallbackChildFragment的按需处理
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);

	// 维持Suspense与primaryChildFragment的联系
	primaryChildFragment.flags |= Visibility;
	primaryChildFragment.return = wip;
	primaryChildFragment.sibling = null;
	wip.child = primaryChildFragment;

	// 若有currentFallbackChildFragment，将其标记删除
	if (currentFallbackChildFragment !== null) {
		const deletions = wip.deletions;
		if (deletions === null) {
			wip.deletions = [currentFallbackChildFragment];
			wip.flags |= ChildrenDeletion;
		} else {
			deletions.push(currentFallbackChildFragment);
		}
	}

	return primaryChildFragment;
}
function updateSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	// 获取suspense对应的current fiber，及其current children和fallback的current fiber
	const current = wip.alternate as FiberNode;
	const currentPrimaryChildFragment: FiberNode = current.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sibling;

	// 将suspense组件的children隐藏
	const primaryChildProps: OffscreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};

	// 获取current fiber tree中，在wip fiber tree中对应的节点
	// 其实就是根据current fiber 和 ReactElement的props属性创建/更新wip fiber
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);

	let fallbackChildFragment;
	if (currentFallbackChildFragment !== null) {
		// fallbackChildFragment有，则更新其wip fiber即可
		fallbackChildFragment = createWorkInProgress(
			currentFallbackChildFragment,
			fallbackChildren
		);
	} else {
		// fallbackChildFragment没有，则创建新的wip fiber
		fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
		// 因为此时Suspense组件已经被挂载，无法为fallback打上Placement 标记，就需要fallback自己打上Placement 标记
		fallbackChildFragment.flags |= Placement;
	}

	// 保持suspense，primaryChildFragment，fallbackChildFragment之间的联系
	fallbackChildFragment.return = wip;
	primaryChildFragment.return = wip;
	primaryChildFragment.sibling = fallbackChildFragment;
	wip.child = primaryChildFragment;

	return fallbackChildFragment;
}

function updateOffscreenComponent(wip: FiberNode) {
	const newProps = wip.pendingProps;
	const nextChildren = newProps.children;

	reconcileChildren(wip, nextChildren);

	return wip.child;
}

function updateContextProvider(wip: FiberNode) {
	// 对于ctx.Provider组件来说，其type就是context对象
	const ProviderType = wip.type;
	const context = ProviderType._context;
	const newProps = wip.pendingProps;

	// debugger;
	pushProvider(context, newProps.value);
	const nextChildren = newProps.children;

	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function updateFragment(wip: FiberNode) {
	const newChildren = wip.pendingProps;
	reconcileChildren(wip, newChildren);

	return wip.child;
}

// 函数组件的处理
function updateFunctionComponent(
	wip: FiberNode,
	Component: FiberNode['type'],
	renderLane: Lane
) {
	// 相当于执行函数组件这个函数，获取其返回值，其返回值就是Children
	const nextChildren = renderWithHooks(wip, Component, renderLane);
	// 根据children的ReactElement生成对应的FiberNode
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

// HostRoot处理情况
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
	// 1.计算属性的新状态
	const baseState = wip.memoizedState;
	const updateQueue = wip.updateQueue as UpdateQueue<Element>;
	const pending = updateQueue.shared.pending;

	//首屏渲染不会被打断，可以直接清空
	updateQueue.shared.pending = null;
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	let current = wip.alternate;
	if (current !== null) {
		current.memoizedState = memoizedState;
	}

	wip.memoizedState = memoizedState;

	// 2.生成子fiberNode
	const nextchildren = wip.memoizedState;
	// console.log('wipupdateHostRoot', wip);
	reconcileChildren(wip, nextchildren);
	return wip.child;
}

// div处理情况
function updateHostComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	markRef(wip.alternate, wip);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

// 根据当前FiberNode和子ReactElement，生成子FiberNode
function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
	const current = wip.alternate;

	if (current !== null) {
		// 更新
		wip.child = reconcileChildFibers(wip, current.child, children);
	} else {
		// 挂载
		wip.child = mountChildFibers(wip, null, children);
	}
}

function markRef(current: FiberNode | null, workInProgress: FiberNode) {
	const ref = workInProgress.ref;

	if (
		(current === null && ref !== null) || // current不存在且ref存在，代表首次挂载需要添加Ref标记
		(current !== null && current.ref !== ref) // current存在且更新前后ref不同，则需要更新ref，打上Ref标记
	) {
		workInProgress.flags |= Ref;
	}
}
