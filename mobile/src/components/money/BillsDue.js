import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Line, Group, Heading } from "../kit";
import { bills, billWhen } from "../../lib/billsApi";

/** Bills that are overdue or due within 3 days, inside Money. "Mark paid" adds the expense to Money and marks the bill paid on the website too. */
export default function BillsDue({ onPaid }) {
  const [list, setList] = useState([]);
  const load = useCallback(() => { bills.due().then((d) => setList(d.due || [])).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!list.length) return null;
  const pay = (b) => Alert.alert("Mark as paid", `${b.name}${b.amount != null ? ` · ₹${b.amount}` : ""}. It is added to Money as an expense.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Mark paid", onPress: async () => { try { await bills.pay(b.id); load(); if (onPaid) onPaid(); } catch (e) { Alert.alert("Could not mark it paid", e.message || "Try again, or use the website (add the amount there if it is not set)."); } } },
  ]);
  return (
    <View style={{ gap: 6 }}>
      <Heading>Bills to pay</Heading>
      <Group>
        {list.map((b, i) => <Line key={b.id} title={b.name} subtitle={`${billWhen(b)}${b.amount != null ? ` · ₹${b.amount}` : ""}`} icon="alert" right={<Text>Mark paid</Text>} onPress={() => pay(b)} last={i === list.length - 1} />)}
      </Group>
    </View>
  );
}
