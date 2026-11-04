import { useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

export interface HoverState {
  hovered: boolean;
  pressed: boolean;
}

type HoverPressableProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle> | ((state: HoverState) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: HoverState) => ReactNode);
};

/**
 * A Pressable that knows when the pointer is over it. React Native's Pressable reports only
 * presses to its style; the hover events are there on web and desktop, so this keeps them.
 */
export function HoverPressable({
  style,
  children,
  onHoverIn,
  onHoverOut,
  ...props
}: HoverPressableProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...props}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      style={({ pressed }) => (typeof style === "function" ? style({ hovered, pressed }) : style)}
    >
      {({ pressed }) =>
        typeof children === "function" ? children({ hovered, pressed }) : children
      }
    </Pressable>
  );
}
