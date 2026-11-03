import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { dashRow } from "./model";

export const getDashSnapshot = defineRpc({
  name: "dash.snapshot",
  input: z.object({}),
  output: z.object({ rows: z.array(dashRow) }),
});
