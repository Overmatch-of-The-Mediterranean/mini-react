import {
	FulfilledThenable,
	PendingThenable,
	RejectedThenable,
	Thenable
} from 'shared/ReactTypes';

// 用来区分suspendse挂起与其余错误
export const SuspenseException = new Error(
	'这不是个真实的错误，而是Suspense工作的一部分。如果你捕获到这个错误，请将它继续抛出去'
);

let suspendedThenable: Thenable<any> | null = null;

function noop() {}

export function getSuspenseThenable(): Thenable<any> {
	if (suspendedThenable === null) {
		throw new Error('应该存在suspendedThenable，这是个bug');
	}

	const thenable = suspendedThenable;
	suspendedThenable = null;

	return thenable;
}

// 对用户传递过来的promise/context进行包装
export function trackUsedThenable<T>(thenable: Thenable<T>) {
	switch (thenable.status) {
		case 'fulfilled':
			return thenable.value;
		case 'rejected':
			throw thenable.reason;
		default:
			if (typeof thenable.status === 'string') {
				thenable.then(noop, noop);
			} else {
				const pending = thenable as unknown as PendingThenable<T, void, any>;
				pending.status = 'pending';
				pending.then(
					(value) => {
						if (pending.status === 'pending') {
							// @ts-ignore
							const fulfilled: FulfilledThenable<T, void, any> = thenable;
							fulfilled.status = 'fulfilled';
							fulfilled.value = value;
						}
					},
					(error) => {
						if (pending.status === 'pending') {
							// @ts-ignore
							const rejected: RejectedThenable<T, void, any> = thenable;
							rejected.status = 'rejected';
							rejected.reason = error;
						}
					}
				);
			}
		// break;
	}
	suspendedThenable = thenable;
	throw SuspenseException;
}
