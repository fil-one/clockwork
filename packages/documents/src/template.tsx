import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#17211b",
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 42,
  },
  header: {
    borderBottomColor: "#245c43",
    borderBottomWidth: 2,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
    paddingBottom: 12,
  },
  brand: { color: "#245c43", fontSize: 15, fontWeight: 700 },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 10 },
  muted: { color: "#5d6b62" },
  section: { marginTop: 20 },
  footer: {
    bottom: 24,
    color: "#5d6b62",
    fontSize: 8,
    left: 42,
    position: "absolute",
    right: 42,
  },
});

export function BrandedDocument({
  title,
  reference,
  children,
}: {
  title: string;
  reference: string;
  children: ReactNode;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>CLOCKWORK</Text>
          <Text style={styles.muted}>{reference}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.section}>{children}</View>
        <Text fixed style={styles.footer}>
          Generated from immutable commerce records. Verify this document by its
          content hash.
        </Text>
      </Page>
    </Document>
  );
}

export { Text, View };
