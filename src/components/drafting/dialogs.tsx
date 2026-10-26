"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Unused } from "@/lib/drafting/document";
import type { DialogRequest, Editor } from "@/lib/drafting/editor";

// The dialogs commands open, as AutoCAD's: Block Definition, Edit Attributes, the block
// editor's save question, and Purge. Each passes its answer back to the editor.

type Of<K extends DialogRequest["kind"]> = Extract<DialogRequest, { kind: K }>;

export function DraftingDialog({ editor, request }: { editor: Editor; request: DialogRequest }) {
  const close = <T,>(result: T | null) => editor.closeDialog(result);
  return (
    <Dialog open onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-md" onKeyDown={(e) => e.stopPropagation()}>
        {request.kind === "block" && <BlockDefinition editor={editor} request={request} />}
        {request.kind === "attributes" && <EditAttributes editor={editor} request={request} />}
        {request.kind === "save-block" && <SaveBlock editor={editor} request={request} />}
        {request.kind === "purge" && <Purge editor={editor} />}
      </DialogContent>
    </Dialog>
  );
}

function BlockDefinition({ editor, request }: { editor: Editor; request: Of<"block"> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"convert" | "retain" | "delete">("convert");
  const trimmed = name.trim();
  const exists = editor.doc.blocks.has(trimmed);
  const invalid = /[<>/\\":;?*|,=`]/.test(trimmed);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed && !invalid) editor.closeDialog({ name: trimmed, description: description.trim(), mode });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Block Definition</DialogTitle>
        <DialogDescription>
          {request.count} object{request.count === 1 ? "" : "s"} selected, about the base point you picked.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="block-name">Name</Label>
        <Input id="block-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus list="block-names" placeholder="e.g. Door 36, North arrow" />
        <datalist id="block-names">
          {[...editor.doc.blocks.keys()].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {invalid && <p className="text-xs text-destructive">{"Names can't contain < > / \\ \" : ; ? * | , = `"}</p>}
        {exists && !invalid && <p className="text-xs text-amber-600 dark:text-amber-400">&quot;{trimmed}&quot; is already defined: it will be redefined, and every reference to it updated.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="block-description">Description</Label>
        <Input id="block-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 text-sm font-medium">Objects</legend>
        {(
          [
            ["convert", "Convert to block"],
            ["retain", "Retain"],
            ["delete", "Delete"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="block-mode" checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || invalid}>
          OK
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditAttributes({ editor, request }: { editor: Editor; request: Of<"attributes"> }) {
  const [values, setValues] = useState(() => Object.fromEntries(request.rows.map((r) => [r.tag, r.value])));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        editor.closeDialog(values);
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Edit Attributes</DialogTitle>
        <DialogDescription>Block: {request.block}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        {request.rows.map((r, i) => (
          <div key={r.tag} className="grid gap-1.5">
            <Label htmlFor={`attr-${r.tag}`}>
              {r.prompt} <span className="font-mono text-xs text-muted-foreground">{r.tag}</span>
            </Label>
            <Input id={`attr-${r.tag}`} value={values[r.tag]} autoFocus={i === 0} onChange={(e) => setValues((v) => ({ ...v, [r.tag]: e.target.value }))} />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => editor.closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit">OK</Button>
      </DialogFooter>
    </form>
  );
}

function SaveBlock({ editor, request }: { editor: Editor; request: Of<"save-block"> }) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Block - Changes Not Saved</DialogTitle>
        <DialogDescription>You changed block &quot;{request.name}&quot;. What do you want to do?</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Button autoFocus onClick={() => editor.closeDialog("save")}>
          Save the changes to {request.name}
        </Button>
        <Button variant="outline" onClick={() => editor.closeDialog("discard")}>
          Discard the changes and close the block editor
        </Button>
      </div>
    </div>
  );
}

const PURGE_GROUPS: [keyof Unused, string][] = [
  ["blocks", "Blocks"],
  ["layers", "Layers"],
  ["textStyles", "Text styles"],
  ["dimStyles", "Dimension styles"],
];

function Purge({ editor }: { editor: Editor }) {
  const [unused, setUnused] = useState(() => editor.doc.unused());
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const total = PURGE_GROUPS.reduce((n, [key]) => n + unused[key].length, 0);
  const purge = (items: Partial<Unused>) => {
    editor.doc.begin("PURGE");
    editor.doc.purge(items);
    editor.doc.commit();
    setUnused(editor.doc.unused());
    setChecked(new Set());
  };
  const checkedItems = () => Object.fromEntries(PURGE_GROUPS.map(([key]) => [key, unused[key].filter((n) => checked.has(`${key}:${n}`))])) as Unused;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Purge</DialogTitle>
        <DialogDescription>Unused named items, which nothing in the drawing refers to. Purging a block can leave more items unused.</DialogDescription>
      </DialogHeader>
      <div className="max-h-72 overflow-y-auto rounded border text-sm">
        {total === 0 ? (
          <p className="p-3 text-muted-foreground">Nothing to purge.</p>
        ) : (
          PURGE_GROUPS.filter(([key]) => unused[key].length).map(([key, label]) => (
            <div key={key}>
              <div className="bg-muted/50 px-2 py-1 text-xs font-semibold">
                {label} ({unused[key].length})
              </div>
              {unused[key].map((name) => {
                const id = `${key}:${name}`;
                return (
                  <label key={id} className="flex items-center gap-2 px-3 py-0.5">
                    <input
                      type="checkbox"
                      checked={checked.has(id)}
                      onChange={() =>
                        setChecked((s) => {
                          const next = new Set(s);
                          if (!next.delete(id)) next.add(id);
                          return next;
                        })
                      }
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => editor.closeDialog(null)}>
          Close
        </Button>
        <Button variant="outline" disabled={!checked.size} onClick={() => purge(checkedItems())}>
          Purge Checked Items
        </Button>
        <Button disabled={!total} onClick={() => purge(unused)}>
          Purge All
        </Button>
      </DialogFooter>
    </div>
  );
}
