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
import { scheduleUpdateOnFiber } from './workLoop';
import { requestUpdateLane } from './fiberLanes';
import {
	unstable_ImmediatePriority,
	unstable_runWithPriority
} from 'scheduler';

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
	// 首屏渲染默认同步更新
	unstable_runWithPriority(unstable_ImmediatePriority, () => {
		const hostRootFiber = root.current;
		const lane = requestUpdateLane();
		const update = createUpdate<ReactElementType | null>(element, lane);
		enqueueUpdate(
			hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
			update
		);

		// 将渲染与触发更新的机制连接了起来
		scheduleUpdateOnFiber(hostRootFiber, lane);
	});

	return element;
}
