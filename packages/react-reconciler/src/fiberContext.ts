import { ReactContext } from 'shared/ReactTypes';

let prevContextValue: any = null;

const prevContextValueStack: any[] = [];

export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	debugger;
	// 仆人(背后背个框子代表prevContextValueStack)，仆人的手代表prevContextValue，少爷A(ctx的值代表衣服)，少爷B
	// pushProvider代表穿上新衣服
	// popProvider代表换回旧衣服

	prevContextValueStack.push(prevContextValue);

	// 每次为不同少爷换衣服时，对于pushProvider手里只会拿着该少爷本次换下的衣服，对于popProvider手里只会拿着该少爷上次换下的衣服
	// 仆人手里只能拿一件衣服，当A少爷要换新衣服时，手里拿着A少爷本次换下的旧衣服。A少爷换完，B少爷要换时，因为手中只能拿一件衣服，所以将A少爷的换下的衣服放入框中，才能拿着B少爷换下的衣服。
	// A少爷换完新衣服，B少爷换新衣服 对应 进入A的beginWork后接着进入A嵌套的B的beginWork
	// A少爷换回旧衣服，B少爷换旧衣服 对应 进入A的completeWork后接着进入A嵌套的B的completeWork
	prevContextValue = context._currentValue;

	context._currentValue = newValue;
}

export function popProvider<T>(context: ReactContext<T>) {
	debugger;
	context._currentValue = prevContextValue;
	prevContextValue = prevContextValueStack.pop();
}
