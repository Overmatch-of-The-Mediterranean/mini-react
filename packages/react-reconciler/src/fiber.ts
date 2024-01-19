import {
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	WorkTag
} from './workTags';
import { Key, Props, ReactElementType, Ref } from '../../shared/ReactTypes';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';

export class FiberNode {
	tag: WorkTag;
	type: any;
	key: Key;
	ref: Ref;
	stateNode: any;

	return: FiberNode | null;
	sibling: FiberNode | null;
	child: FiberNode | null;
	index: number;

	updateQueue: unknown;
	pendingProps: Props;
	memoizedProps: Props | null;
	memoizedState: any;

	alternate: FiberNode | null;

	subTreeFlags: Flags;
	flags: Flags;
	deletions: FiberNode[] | null;
	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		// FiberNode的类型
		this.tag = tag;

		// 对于FunctionComponent，指函数本身 FunctionComponent ()=>{}
		// 对于ClassComponent，指class
		// 对于HostComponent，指DOM tagName(小写形式)
		this.type = null;
		this.key = key || null;
		this.ref = null;

		// FiberNode对应的元素，比如，FunctionComponent对应的DOM元素
		this.stateNode = null;

		// 构建树结构
		this.return = null;
		this.sibling = null;
		this.child = null;
		// 一般如果没有兄弟节点的话是 0 当某个父节点下的子节点是数组类型的时候会给每个子节点一个 index
		this.index = 0;

		// 工作单元
		this.updateQueue = null;
		// 新的props，也就是待处理的props，其实就是该Fiber对应的ReactElement的props属性或props的children属性，jsx('li', { children,... }, ...)
		this.pendingProps = pendingProps;
		// 现有的props(上一次)
		this.memoizedProps = null;
		// 现有的State，类组件保存state信息，函数组件保存hooks信息
		this.memoizedState = null;

		this.alternate = null;
		this.flags = NoFlags;
		this.subTreeFlags = NoFlags;
		this.deletions = null;
	}
}

export class FiberRootNode {
	container: Container;
	current: FiberNode;
	// 已经更新完后的hostRootFiber
	finishedWork: FiberNode | null;
	constructor(container: Container, hostRootFiber: FiberNode) {
		// 建立FiberRootNode 与 HostRootFiber之间的联系
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
	}
}

export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
) => {
	let wip = current.alternate;
	// current是当前正在显示的UI对应的HostRootFiber，根据其有无对应的 wip HostRootFiber
	// 来决定进行挂载流程还是更新流程的操作
	if (wip === null) {
		// mount
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;

		wip.alternate = current;
		current.alternate = wip;
	} else {
		// update
		wip.pendingProps = pendingProps;
		wip.flags = NoFlags;
		wip.subTreeFlags = NoFlags;
		wip.deletions = null;
	}

	wip.type = current.type;
	wip.child = current.child;
	wip.updateQueue = current.updateQueue;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;

	// 返回 正在创建的wip Fiber tree的HostRootFiber
	return wip;
};

// beginWork阶段，创建子FiberNode使用的函数
export function createFiberFromElement(element: ReactElementType) {
	const { type, key, props } = element;

	let fiberTag: WorkTag = FunctionComponent;

	if (typeof type === 'string') {
		fiberTag = HostComponent;
	} else if (typeof type !== 'function') {
		console.warn('为定义的type类型', fiberTag);
	}

	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	return fiber;
}
export function createFiberFromFragment(elements: any[], key: Key) {
	const fiber = new FiberNode(Fragment, elements, key);
	return fiber;
}
