import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { UpdateQueue, processUpdateQueue } from './updateQueue';
import {
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';

// 递归的递阶段
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// 根据Fiber的类型，进行不同的操作，最终根据当前FiberNode生成子FiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			return null;
		case FunctionComponent:
			return updateFunctionComponent(wip, renderLane);
		case Fragment:
			return updateFragment(wip);
		default:
			if (__DEV__) {
				console.warn('begin未实现的类型');
			}
			break;
	}
	return null;
};

function updateFragment(wip: FiberNode) {
	const newChildren = wip.pendingProps;
	reconcileChildren(wip, newChildren);

	return wip.child;
}

// 函数组件的处理
function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
	// 相当于执行函数组件这个函数，获取其返回值，其返回值就是Children
	const nextChildren = renderWithHooks(wip, renderLane);
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
