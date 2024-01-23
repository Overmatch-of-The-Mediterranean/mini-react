import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority,
	unstable_runWithPriority
} from 'scheduler';
import { Props } from 'shared/ReactTypes';

/*
    1.react中事件回调保存在react组件的props中，reactDOM如何拿到组件的props，
    对于每个reactDOM，我们将它对应的props保存在它对应的DOM的对象上面。
    2.SyntheticEvent文件中放于reactDOM相关的事件系统。
    3.targetElement触发事件，这个事件会被代理到Container(挂载应用根节点的那个DOM元素)下面，
    接下来收集触发事件的targetElement到Container之间的所有祖先Element的props中对应事件的回调。

*/
export const elementPropsKey = '__props';

export interface DOMElement extends Element {
	[elementPropsKey]: Props;
}

type EventCallback = (e: Event) => void;

interface Paths {
	capture: EventCallback[];
	bubble: EventCallback[];
}

interface SyntheticEvent extends Event {
	__stopPropagation: boolean;
}

const validEventTypeList = ['click'];

// 用于对接reactDOM与reconciler
export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
	}

	if (__DEV__) {
		console.warn('初始化事件', eventType);
	}

	container.addEventListener(eventType, (e) => {
		dispatchEvent(container, eventType, e);
	});
}

export function dispatchEvent(
	container: Container,
	eventType: string,
	e: Event
) {
	const targetElement = e.target;
	if (targetElement === null) {
		console.warn('事件不存在target', e);
		return;
	}

	// 1.收集沿途事件
	const { capture, bubble } = collectPaths(
		targetElement as DOMElement,
		container,
		eventType
	);
	// 2.合成事件
	const se = createSyntheticEvent(e);
	// 3.capture
	triggerEventFlow(capture, se);
	// 4.bubble
	if (!se.__stopPropagation) {
		triggerEventFlow(bubble, se);
	}
}

// 触发事件回调执行
function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];

		unstable_runWithPriority(eventTypeToSchedulerPriority(se.type), () => {
			callback.call(null, se);
		});

		if (se.__stopPropagation) {
			break;
		}
	}
}

// 创建合成事件，也就是react种对原生事件对象做了一层封装
function createSyntheticEvent(e: Event) {
	const syntheticEvent = e as SyntheticEvent;
	syntheticEvent.__stopPropagation = false;
	const originStopPropagation = e.stopPropagation;

	syntheticEvent.stopPropagation = () => {
		syntheticEvent.__stopPropagation = true;
		if (originStopPropagation) {
			originStopPropagation();
		}
	};

	return syntheticEvent;
}

function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

// 从targetElement到container的途中，收集每个element的事件回调函数，例如捕获阶段和冒泡阶段的回调
function collectPaths(
	targetElement: DOMElement,
	container: Container,
	eventType: string
) {
	const paths: Paths = {
		capture: [],
		bubble: []
	};

	while (targetElement && targetElement !== container) {
		const elementProps = targetElement[elementPropsKey];
		if (elementProps) {
			const callbackNameList = getEventCallbackNameFromEventType(eventType);
			if (callbackNameList) {
				callbackNameList.forEach((callbackName, i) => {
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
						if (i === 0) {
							paths.capture.unshift(eventCallback);
						} else {
							paths.bubble.push(eventCallback);
						}
					}
				});
			}
		}
		targetElement = targetElement.parentNode as DOMElement;
	}
	return paths;
}

function eventTypeToSchedulerPriority(eventType: string) {
	switch (eventType) {
		case 'click':
		case 'keyup':
		case 'keydown':
			return unstable_ImmediatePriority;
		case 'scroll':
			return unstable_UserBlockingPriority;
		default:
			return unstable_NormalPriority;
	}
}
