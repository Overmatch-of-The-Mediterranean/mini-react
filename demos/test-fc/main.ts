import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_ImmediatePriority as ImmediatePriority,
	unstable_UserBlockingPriority as UserBlockingPriority,
	unstable_NormalPriority as NormalPriority,
	unstable_LowPriority as LowPriority,
	unstable_IdlePriority as IdlePriority,
	unstable_getFirstCallbackNode as getFirstCallbackNode,
	unstable_cancelCallback as cancelCallback,
	unstable_shouldYield as shouldYield,
	CallbackNode
} from 'scheduler';

const root = document.querySelector('#root');

type Priority =
	| typeof ImmediatePriority
	| typeof UserBlockingPriority
	| typeof NormalPriority
	| typeof LowPriority
	| typeof IdlePriority;

interface Work {
	count: number;
	priority: Priority;
}

let workList: Work[] = [];
let curCallback: CallbackNode | null = null;
let prevPriority = IdlePriority;

[LowPriority, NormalPriority, UserBlockingPriority, ImmediatePriority].forEach(
	(priority) => {
		const button = document.createElement('button');
		button.innerText = [
			'',
			'ImmediatePriority',
			'UserBlockingPriority',
			'NormalPriority',
			'LowPriority'
		][priority];
		button.onclick = () => {
			workList.push({
				count: 100,
				priority: priority as Priority
			});
			schedule();
		};
		root?.appendChild(button);
	}
);

function schedule() {
	// 取得当前正在调度的回调
	const cbNode = getFirstCallbackNode();

	// 从任务队列中选取优先级最大的任务
	const curWork = workList.sort(
		(work1, work2) => work1.priority - work2.priority
	)[0]; // 取出优先数最低，也就是优先级最高的任务

	// 判断任务队列中是否有任务
	if (!curWork) {
		// 任务队列中没有任务了
		curCallback = null;
		// 取消当前正在调度的回调
		cbNode && cancelCallback(cbNode);
		return;
	}

	// 有任务
	const { priority: curPriority } = curWork;

	if (prevPriority === curPriority) {
		return;
	}

	// 当前取出的任务优先级高，则先终止正在调度的回调
	cbNode && cancelCallback(cbNode);
	// 再调度优先级高的当前任务，scheduleCallback返回正在调度的回调
	curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
}

function perform(work: Work, didTimeOut?: boolean) {
	/*  什么样的情况，任务会继续执行，不会中断
        1.同步任务，work.priority是ImmediatePriority
        2.饥饿问题，使用didTimeOut标识来解决的饥饿任务
        3.timeSlice还有，使用shouldYield函数判断时间片是否用完
    */
	const needSync = work.priority === ImmediatePriority || didTimeOut;

	// (是同步任务 || 时间片还有) && 该任务还没有执行完
	while ((needSync || !shouldYield()) && work.count) {
		work.count--;
		insertSpan(work.priority + '');
	}

	// 任务中断或执行完成
	prevPriority = work.priority;

	// 判断当前任务是否执行完，执行完，则从任务队列中清除
	if (!work.count) {
		const workIndex = workList.indexOf(work);
		workList.splice(workIndex, 1);
		prevPriority = IdlePriority;
	}

	// 取得上次的回调
	const prevCallback = curCallback;
	schedule();
	// 获取新的回调
	const newCallback = curCallback;

	// 若新回调和旧回调相等。则继续执行这一类任务
	// 比如，上次是ImmediatePriority，这次还是ImmediatePriority,则在schedule会直接返回，还是执行这一类的任务
	if (newCallback && prevCallback === newCallback) {
		return perform.bind(null, work);
	}
}

function insertSpan(content: string) {
	const span = document.createElement('span');
	span.className = `pri-${content}`;
	span.innerText = content;
	root?.appendChild(span);
	doSomeWork(10000000);
}

function doSomeWork(len: number) {
	let result = 0;
	while (len--) {
		result += len;
	}
}
