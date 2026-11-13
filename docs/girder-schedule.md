# Girder schedule (LRFD Bridge Design Check)

At the end of the girder tool, and on its own page at the end of the calc package (before the
summary of the checks). It follows CDOT worksheet B-618-CBT1's Girder Schedule and is filled from
the design (`lib/design/girders/schedule.ts`).

**Rows:** each span's exterior girders (A and the last letter, as in the bridge's typical section)
and interior girders (B to the next-to-last), because their deflection and camber differ.

**Columns:**
- Girder type, span, girder letters.
- L: the girder's length.
- Lh: the end to the harping point; none for straight strands.
- As\*: the strands provided.
- Ee and Ec: the strands' centroid above the bottom at the end and at midspan, all strands.
- Fj = Aps·fpj and Ff = Aps·fpe.
- f′ci and f′c.
- Δ: the deflection at midspan from the deck and the later dead loads.
- The predicted camber at release, and at the deck's casting age. CDOT's table is at 60 days,
  so the age is stated.

**When it's final:** the schedule is marked preliminary until every span and pier checks out.

**Also included:**
- The debonding table that sheet's designer note asks for: the strand rows with debonded
  strands, their number and the length from each end.
- The girder elevation (`components/design/girder-schedule-sketch.tsx`): half the girder with
  the strand centroid from Ee through Lh to Ec, the bearing and span centerlines, and the
  debonded lengths.
