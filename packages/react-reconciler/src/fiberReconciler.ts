import { Container } from 'hostConfig';
import { FiberNode, FiberRootNode } from './fiber';
import { HostRoot } from './workTags';
import {
	UpdateQueue,
	createUpdate,
	createUpdateQueue,
	enqueueUpdate
} from './updateQueue';
import { ReactElementType } from 'shared/ReactTypes';
import { schedulerUpdateOnFiber } from './workLoop';

// ReactDOM.createRoot(rootElement).render(<App/>)
// 执行ReactDOM.createRoot(rootElement)时，内部会调用createContainer，创建HostRootFiber和FiberRootNode
export function createContainer(container: Container) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null);
	const root = new FiberRootNode(container, hostRootFiber);
	// 使用updateQueue将其接入更新机制
	hostRootFiber.updateQueue = createUpdateQueue();
	return root;
}

//执行render(<App/>)时，内部调用updateContainer
export function updateContainer(
	element: ReactElementType | null,
	root: FiberRootNode
) {
	const hostRootFiber = root.current;
	const update = createUpdate<ReactElementType | null>(element);
	enqueueUpdate(
		hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
		update
	);

	// 将渲染与触发更新的机制连接了起来
	schedulerUpdateOnFiber(hostRootFiber);
	return element;
}
