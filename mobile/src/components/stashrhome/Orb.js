import React, { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

const TONE = { on: "#22C55E", idle: "#F59E0B", off: "#EF4444" };
const GLYPH = { tv: "📺", hub: "🖥", phone: "📱" };

/**
 * The centre of Stashr Home: pulsing rings, the people at home in the middle, and the real devices orbiting.
 * `still` (reduced motion / low power) draws it without animation. Motion uses the native driver only.
 */
export default function Orb({ size = 300, accent = "#22C55E", bad = false, nodes = [], centre, sub, still }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return undefined;
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [spin, pulse, still]);

  const core = bad ? "#EF4444" : accent;
  const r = size / 2;
  const orbit = r - 26;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View style={{ width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={core} stopOpacity="0.55" />
            <Stop offset="0.6" stopColor={core} stopOpacity="0.12" />
            <Stop offset="1" stopColor={core} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill="url(#g)" />
        <Circle cx={r} cy={r} r={orbit} stroke={core} strokeOpacity={0.28} strokeWidth={1} fill="none" strokeDasharray="2 7" />
        <Circle cx={r} cy={r} r={orbit * 0.62} stroke={core} strokeOpacity={0.2} strokeWidth={1} fill="none" />
      </Svg>
      <Animated.View style={{ position: "absolute", width: orbit * 1.1, height: orbit * 1.1, borderRadius: orbit, borderWidth: 2, borderColor: core, opacity: still ? 0.4 : glow, transform: [{ scale: still ? 1 : scale }] }} />
      <Animated.View style={{ position: "absolute", width: size, height: size, transform: [{ rotate: still ? "0deg" : rotate }] }}>
        {nodes.map((n, i) => {
          const ang = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const x = r + Math.cos(ang) * orbit - 22, y = r + Math.sin(ang) * orbit - 22;
          return (
            <Animated.View key={n.id || i} style={{ position: "absolute", left: x, top: y, width: 44, height: 44, alignItems: "center", justifyContent: "center", transform: [{ rotate: still ? "0deg" : counter }] }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(15,23,42,0.85)", borderWidth: 2, borderColor: TONE[n.tone] || TONE.off, alignItems: "center", justifyContent: "center", opacity: n.tone === "off" ? 0.7 : 1 }}>
                <Text style={{ fontSize: 17 }}>{GLYPH[n.kind] || "•"}</Text>
              </View>
            </Animated.View>
          );
        })}
      </Animated.View>
      <View style={{ alignItems: "center", maxWidth: orbit * 1.2 }}>
        <Text style={{ color: "#F8FAFC", fontSize: 40, fontWeight: "700" }}>{centre}</Text>
        {sub ? <Text style={{ color: "#CBD5E1", fontSize: 12.5, textAlign: "center", marginTop: 2 }} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </View>
  );
}
