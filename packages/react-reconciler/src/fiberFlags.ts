export type Flags = number;

export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildrenDeletion = 0b0000100;
export const Ref = 0b0010000;

// 代表当前fiber本次更新有副作用需要执行
export const PassiveEffect = 0b0001000;

export const MutationMask = Placement | Update | ChildrenDeletion;
export const LayoutMask = Ref;

export const PassiveMask = PassiveEffect | ChildrenDeletion;
