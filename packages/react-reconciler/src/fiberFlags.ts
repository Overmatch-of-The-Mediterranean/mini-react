export type Flags = number;

export const NoFlags = 0b00000000;
export const Placement = 0b00000001;
export const Update = 0b00000010;
export const ChildrenDeletion = 0b00000100;
export const Ref = 0b00010000;
export const Visibility = 0b00100000;
export const ShouldCapture = 0b01000000;
export const DidCapture = 0b10000000;

// 代表当前fiber本次更新有副作用需要执行
export const PassiveEffect = 0b00001000;

export const MutationMask =
	Placement | Update | ChildrenDeletion | Visibility | Ref;
export const LayoutMask = Ref;

export const PassiveMask = PassiveEffect | ChildrenDeletion;

export const HostEffectMask =
	MutationMask | LayoutMask | PassiveMask | DidCapture;
