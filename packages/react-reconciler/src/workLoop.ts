import { beginWork } from './beginWork';
import { commitMutationEffects } from './commitWork';
import { completeWork } from './completeWork';
import { FiberNode, FiberRootNode, createWorkInProgress } from './fiber';
import { MutationMask, NoFlags } from './fiberFlags';
import { HostRoot } from './workTags';

// 指向正在工作的fiberNode。类似Vue中的activeEffect吗
let workInProgress: FiberNode | null = null;

// 初始化指向根节点
export const prepareFreshStack = (root: FiberRootNode) => {
	// 传入FiberRootNode的current，也就是当前正在显示的UI对应的HostRootFiber
	workInProgress = createWorkInProgress(root.current, {});
};

export const schedulerUpdateOnFiber = (fiber: FiberNode) => {
	const root = markUpdateFromFiberToRoot(fiber);
	// 传入 wip HostRootFiber，开始reconciler流程
	renderRoot(root);
};

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
function renderRoot(root: FiberRootNode) {
	// 初始化workInProgress
	prepareFreshStack(root);

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

	// 重置
	root.finishedWork = null;
	// 判断是否有需要执行对应DOM操作的flags
	const subTreeHasEffect =
		(finishedWork.subTreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

	// 代表新生成的wip Fiber tree中有需要进行操作的Flags标记
	if (subTreeHasEffect || rootHasEffect) {
		// 有，则按照标记执行不同的阶段
		// beforeMutation
		// Mutation
		commitMutationEffects(finishedWork);

		// 至此已经完成wip Fiber tree的渲染，切换current的指向
		root.current = finishedWork;
		// layout
	} else {
		root.current = finishedWork;
	}
}

function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

// 对每个工作单元(FiberNode)执行beginWork和compeleteWork
function performUnitOfWork(fiber: FiberNode) {
	// beginWork根据当期FiberNode创建下一级FiberNode
	const next = beginWork(fiber);
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
