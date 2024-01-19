export type WorkTag =
	| typeof FunctionComponent
	| typeof HostRoot
	| typeof HostComponent
	| typeof HostText
	| typeof Fragment;

export const FunctionComponent = 0;

// createRoot.render()，根容器对应的fiberNode类型
export const HostRoot = 3;

// <div></div>，对应的fiberNode类型
export const HostComponent = 5;

// <div>123</div>，123这个文本对应的fiberNode类型
export const HostText = 6;
export const Fragment = 7;
