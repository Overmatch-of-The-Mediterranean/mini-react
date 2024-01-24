import { FiberNode } from './fiber';
import { NoFlags, Ref, Update } from './fiberFlags';
import {
	Container,
	Instance,
	appendInitialChild,
	createInstance,
	createTextInstance
} from 'hostConfig';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { popProvider } from './fiberContext';
// import { updateFiberProps } from 'react-dom/src/syntheticEvent';

function markRef(fiber: FiberNode) {
	fiber.flags |= Ref;
}

function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

// 递归的归阶段
// mount阶段，则创建DOM树，初始化属性
// update阶段，则打上Update标签
// 最后再进行flags冒泡
export const completeWork = (wip: FiberNode) => {
	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// update

				// reactDOM与reconciler对接的第二种时机，更新props时
				// updateFiberProps(wip.stateNode, newProps);
				markUpdate(wip);
				if (current.ref !== wip.ref) {
					markRef(wip);
				}
			} else {
				// 创建DOM
				const instance = createInstance(wip.type, newProps);
				// 将DOM插入到DOM树中
				appendAllChildren(instance, wip);

				wip.stateNode = instance;
				if (wip.ref !== null) {
					markRef(wip);
				}
			}
			bubbleProperties(wip);
			return null;
		case HostText:
			if (current !== null && wip.stateNode) {
				// update
				const oldText = current.memoizedProps.content;
				const newText = newProps.content;
				if (oldText !== newText) {
					markUpdate(wip);
				}
			} else {
				// 创建DOM
				const instance = createTextInstance(newProps.content);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;
		case HostRoot:
		case FunctionComponent:
		case Fragment:
			bubbleProperties(wip);
			return null;
		case ContextProvider:
			const context = wip.type._context;
			debugger;
			popProvider(context);
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
			break;
	}
};

function appendAllChildren(parent: Container | Instance, wip: FiberNode) {
	let node = wip.child;

	// 将子fiber对应的真实DOM插入到父真实DOM中，因为complete是向上归的过程
	// 所以，当父DOM创建时，子DOM早就创建好了
	while (node !== null) {
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node.stateNode);
		} else if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}

		if (node === wip) {
			return;
		}

		while (node.sibling === null) {
			if (node.return === null || node.return === wip) {
				return;
			}
			node = node.return;
		}
		node.sibling!.return = node.return;
		node = node.sibling;
	}
}

// flags冒泡，将子flags和子的subTreeFlags冒泡到子的父Fiber上
function bubbleProperties(wip: FiberNode) {
	let subTreeFlags = NoFlags;

	let child = wip.child;

	while (child !== null) {
		subTreeFlags |= child!.subTreeFlags;
		subTreeFlags |= child!.flags;

		child.return = wip;
		child = child.sibling;
	}

	wip.subTreeFlags |= subTreeFlags;
}
