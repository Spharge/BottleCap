#!/usr/bin/env python3
"""
bottlecap.py
============
Generates a 3D-printable bottle cap adapter that joins two bottles with
different thread sizes (e.g. two different dish-soap bottles).

Each cap is female --it screws onto the male threads of a bottle.
The two caps are joined by a solid connector cylinder to form one piece.

Output: an OpenSCAD (.scad) source file, plus an STL if OpenSCAD is in PATH.

Thread geometry notes
---------------------
  Major diameter (OD)  – outer diameter of the male threads you are mating
  Pitch                – axial distance between adjacent thread crests (mm)
  Starts               – number of independent thread helices (1 = single start)
  Lead                 – axial advance per full revolution = pitch × starts
  Thread depth         – radial height of the thread tooth
  Thread angle         – included flank angle (60° for ISO metric, varies for plastics)

Clearance of 0.3 mm (total diametral) is added to the bore so the cap
actually fits on the bottle after FDM printing.
"""

import math
import os
import subprocess
import sys


# ── Input helpers ────────────────────────────────────────────────────────────

def ask_float(prompt: str, hint: str = None, default=None,
              min_val: float = None, max_val: float = None) -> float:
    """Prompt for a float with optional hint text, default, and range validation."""
    if hint:
        for line in hint.split("\n"):
            print(f"      {line}")
    suffix = f" [{default}]" if default is not None else ""
    while True:
        raw = input(f"   -> {prompt}{suffix}: ").strip()
        if raw == "" and default is not None:
            return float(default)
        try:
            val = float(raw)
        except ValueError:
            print("      ! Please enter a number (e.g. 28.5).")
            continue
        if min_val is not None and val < min_val:
            print(f"      ! Value must be at least {min_val}.")
            continue
        if max_val is not None and val > max_val:
            print(f"      ! Value must be at most {max_val}.")
            continue
        if val <= 0:
            print("      ! Value must be greater than 0.")
            continue
        return val


def ask_int(prompt: str, hint: str = None, default: int = None,
            min_val: int = 1, max_val: int = None) -> int:
    """Prompt for an integer with optional hint text, default, and range validation."""
    if hint:
        for line in hint.split("\n"):
            print(f"      {line}")
    suffix = f" [{default}]" if default is not None else ""
    while True:
        raw = input(f"   -> {prompt}{suffix}: ").strip()
        if raw == "" and default is not None:
            return int(default)
        try:
            val = int(raw)
        except ValueError:
            print("      ! Please enter a whole number.")
            continue
        if val < min_val:
            print(f"      ! Value must be at least {min_val}.")
            continue
        if max_val is not None and val > max_val:
            print(f"      ! Value must be at most {max_val}.")
            continue
        return val


def prompt_bottle(label: str) -> dict:
    """
    Interactively collect all thread dimensions for one bottle,
    with step-by-step measurement guidance.
    """
    print()
    print(f"  {'-'*54}")
    print(f"  {label}")
    print(f"  {'-'*54}")
    print()
    print("  Grab this bottle and a ruler or calipers.")
    print("  All measurements are in millimetres (mm).")
    print()

    # ── Step 1: Major diameter ──────────────────────────────────────────────
    print("  [1/8] Thread Major Diameter")
    od = ask_float(
        "Outer diameter of bottle neck at thread peaks (mm)",
        hint="Using calipers, measure across the widest point of the\n"
             "threads on the bottle neck (peak to peak).",
        min_val=5.0, max_val=200.0,
    )

    # ── Step 2: Thread pitch ─────────────────────────────────────────────────
    print()
    print("  [2/8] Thread Pitch")
    measured_pitch = ask_float(
        "Distance between thread crests (mm)",
        hint="The distance between two adjacent thread peaks (crest to crest).\n"
             "If multiple peaks: measure across N peaks, divide by (N-1).\n"
             "E.g. 2 peaks: just measure the gap. 5 peaks: divide by 4.",
        min_val=0.5, max_val=20.0,
    )

    # ── Step 3: Thread width ───────────────────────────────────────────────
    print()
    print("  [3/8] Thread Width")
    thread_width = ask_float(
        "Width of one thread ridge (mm)",
        hint="Measure the width of a single thread ridge along the neck.\n"
             "This is the solid raised part only, not the gap.",
        min_val=0.3, max_val=20.0,
    )

    # ── Step 4: Valley width ───────────────────────────────────────────────
    print()
    print("  [4/8] Valley Width")
    valley_width = ask_float(
        "Width of the gap between threads (mm)",
        hint="Measure the gap/groove between two adjacent thread ridges.",
        min_val=0.1, max_val=20.0,
    )

    # ── Cross-check: pitch vs thread_width + valley_width ──────────────────
    derived_pitch = thread_width + valley_width
    pitch = (measured_pitch + derived_pitch) / 2.0

    if abs(measured_pitch - derived_pitch) > 0.5:
        print()
        print(f"      NOTE: Your pitch ({measured_pitch:.2f} mm) doesn't quite match")
        print(f"      thread width + valley ({thread_width:.2f} + {valley_width:.2f} = {derived_pitch:.2f} mm).")
        print(f"      Using averaged value: {pitch:.2f} mm.")
        print(f"      If this looks wrong, double-check your measurements.")
    elif abs(measured_pitch - derived_pitch) > 0.1:
        print(f"      (Pitch averaged: {pitch:.2f} mm from measurements)")
    else:
        print(f"      (Measurements consistent -- pitch: {pitch:.2f} mm)")

    # ── Step 5: Thread starts ──────────────────────────────────────────────
    print()
    print("  [5/8] Thread Starts")
    starts = ask_int(
        "Number of thread starts",
        hint="Most bottles use 1 (single-start). Some wide-mouth bottles\n"
             "use 2 (double-start) for faster opening. Look at the top of\n"
             "the bottle neck: count how many separate thread beginnings\n"
             "you can see.",
        default=1, min_val=1, max_val=8,
    )

    # ── Step 6: Thread depth ───────────────────────────────────────────────
    print()
    print("  [6/8] Thread Depth")
    depth_default = round(pitch * 0.6134, 2)   # ISO H/8 approximation
    depth = ask_float(
        "Thread depth (mm)",
        hint="The height of a thread ridge from the bottle neck surface\n"
             "to the top of the thread. Typical: 0.5 - 1.5 mm.\n"
             f"Default ({depth_default}) is auto-calculated from the pitch.\n"
             "Just press Enter to accept if you're unsure.",
        default=depth_default, min_val=0.1, max_val=5.0,
    )

    # ── Step 7: Turns to engage ────────────────────────────────────────────
    print()
    print("  [7/8] Engagement Turns")
    turns = ask_float(
        "Number of full turns to engage",
        hint="How many full rotations to fully screw on the cap.\n"
             "Put the cap on the bottle and count the turns to tighten.\n"
             "Typical: 1.5 - 3.",
        default=2, min_val=0.5, max_val=10.0,
    )

    # ── Step 8: Wall thickness ─────────────────────────────────────────────
    print()
    print("  [8/8] Wall Thickness")
    wall = ask_float(
        "Cap wall thickness beyond the threads (mm)",
        hint="How thick the adapter wall should be outside the threads.\n"
             "Thicker = stronger but bulkier. 3mm is a good default\n"
             "for FDM printing.",
        default=3.0, min_val=1.0, max_val=20.0,
    )

    # ── Summary ────────────────────────────────────────────────────────────
    lead = pitch * starts
    engage_h = turns * lead + pitch
    bore_r = od / 2.0 + 0.15   # with 0.3mm clearance / 2
    outer_d = 2 * (bore_r + depth + wall)
    print()
    print(f"  Summary for {label}:")
    print(f"    Thread OD:       {od:.1f} mm")
    print(f"    Pitch (avg):     {pitch:.2f} mm  x  {starts} start(s)")
    print(f"    Thread width:    {thread_width:.2f} mm  (valley: {valley_width:.2f} mm)")
    print(f"    Thread depth:    {depth:.2f} mm")
    print(f"    Engagement:      {turns} turns ({engage_h:.1f} mm)")
    print(f"    Adapter OD:      ~{outer_d:.1f} mm (with {wall:.1f} mm wall)")

    return {
        "label":  label,
        "od":     od,
        "pitch":  pitch,
        "starts": starts,
        "thread_width": thread_width,
        "depth":  depth,
        "turns":  turns,
        "wall":   wall,
    }


# ── Geometry ─────────────────────────────────────────────────────────────────

def compute_cap(p: dict, clearance: float) -> dict:
    """
    Derive all geometry values needed for the OpenSCAD model.

    bore_r       -- inner bore radius (male OD/2 + half of diametral clearance)
    outer_r      -- outer cap radius  (bore_r + thread depth + wall)
    lead         -- axial advance per revolution (pitch x starts)
    engage_h     -- total threaded-zone height (turns x lead + one extra pitch)
    thread_width -- axial width of each thread ridge (directly from user)
    """
    bore_r  = p["od"] / 2.0 + clearance / 2.0
    lead    = p["pitch"] * p["starts"]
    outer_r = bore_r + p["depth"] + p["wall"]
    # Extra pitch gives a lead-in gap at the bottom of the thread zone.
    engage_h = p["turns"] * lead + p["pitch"]

    return {
        "label":        p["label"],
        "bore_r":       bore_r,
        "outer_r":      outer_r,
        "lead":         lead,
        "engage_h":     engage_h,
        "pitch":        p["pitch"],
        "starts":       p["starts"],
        "depth":        p["depth"],
        "thread_width": p["thread_width"],
    }


# ── OpenSCAD code generation ─────────────────────────────────────────────────

def generate_scad(bottle_a: dict, bottle_b: dict,
                  clearance: float = 0.3,
                  connector_h: float = 8.0) -> str:
    """
    Return an OpenSCAD script that models the complete adapter.

    Thread implementation
    ---------------------
    Each thread ridge is built from hull()'d pairs of thin slices placed
    along the helix path.  Each slice is a cube with the correct axial
    width (thread_width) and radial depth, positioned and rotated to
    follow the helix.  hull() connects adjacent slices into solid
    trapezoidal segments.  This gives precise control over thread width
    in the axial direction -- unlike the linear_extrude+twist approach,
    which maps the polygon's Y to circumferential (not axial) width.

    Assembly
    --------
    Cap A is placed with its opening at z = 0 (faces down on the print bed).
    Cap B is flipped 180 degrees around X so its opening faces upward (+Z).
    The 180 degree flip reverses the twist direction in global coordinates,
    which is exactly what is needed: a bottle with a standard right-hand
    thread that screws in from above will engage correctly.
    """
    ca = compute_cap(bottle_a, clearance)
    cb = compute_cap(bottle_b, clearance)

    conn_r   = max(ca["outer_r"], cb["outer_r"])
    # The flow-through bore uses the smaller of the two bore radii
    flow_r   = min(ca["bore_r"], cb["bore_r"])
    a_cap_h  = ca["engage_h"] + 2.0   # +2 mm solid roof
    b_cap_h  = cb["engage_h"] + 2.0
    total_h  = a_cap_h + connector_h + b_cap_h

    def fmt(v: float) -> str:
        return f"{v:.4f}"

    lines = [
        f"// ============================================================",
        f"// Bottle Cap Adapter",
        f"// {ca['label']}  <->  {cb['label']}",
        f"// Generated by bottlecap.py",
        f"//",
        f"// Total height : {total_h:.1f} mm",
        f"// Cap A OD     : {fmt(ca['outer_r'] * 2)} mm  (opening at BOTTOM)",
        f"// Cap B OD     : {fmt(cb['outer_r'] * 2)} mm  (opening at TOP)",
        f"// Clearance    : {clearance} mm (diametral)",
        f"//",
        f"// Print notes  : No special orientation needed -- the model already",
        f"//   sits flat.  Enable auto-supports in Bambu Studio for the upper",
        f"//   cap bore overhang.  0.2 mm layer height recommended.",
        f"// ============================================================",
        f"",
        f"$fn = 120;   // facet count for cylinders",
        f"",
        f"// ── Cap A  ({ca['label']})",
        f"A_bore_r       = {fmt(ca['bore_r'])};   // inner bore radius (valley)",
        f"A_outer_r      = {fmt(ca['outer_r'])};   // outer cap radius",
        f"A_lead         = {fmt(ca['lead'])};   // axial advance per revolution",
        f"A_pitch        = {fmt(ca['pitch'])};",
        f"A_starts       = {ca['starts']};",
        f"A_depth        = {fmt(ca['depth'])};   // thread depth (radial)",
        f"A_thread_width = {fmt(ca['thread_width'])};   // axial width of thread ridge",
        f"A_engage_h     = {fmt(ca['engage_h'])};   // threaded zone height",
        f"A_cap_h        = {fmt(a_cap_h)};   // total cap height",
        f"",
        f"// ── Cap B  ({cb['label']})",
        f"B_bore_r       = {fmt(cb['bore_r'])};",
        f"B_outer_r      = {fmt(cb['outer_r'])};",
        f"B_lead         = {fmt(cb['lead'])};",
        f"B_pitch        = {fmt(cb['pitch'])};",
        f"B_starts       = {cb['starts']};",
        f"B_depth        = {fmt(cb['depth'])};",
        f"B_thread_width = {fmt(cb['thread_width'])};",
        f"B_engage_h     = {fmt(cb['engage_h'])};",
        f"B_cap_h        = {fmt(b_cap_h)};",
        f"",
        f"// ── Connector",
        f"conn_r  = {fmt(conn_r)};",
        f"conn_h  = {connector_h};",
        f"flow_r  = {fmt(flow_r)};   // flow-through bore radius",
        f"",
        f"// ============================================================",
        f"// thread_ridges -- helical ridges on the inside of a bore",
        f"//",
        f"// Uses hull() of adjacent thin slices along the helix path.",
        f"// Each slice is a cube with the exact axial thread_width and",
        f"// radial depth, giving precise FDM-printable thread geometry.",
        f"// ============================================================",
        f"module thread_ridges(bore_r, lead, starts, depth,",
        f"                     thread_width, engage_h) {{",
        f"    segs_per_turn = 72;",
        f"    turns = engage_h / lead;",
        f"    total_segs = ceil(segs_per_turn * turns);",
        f"    wall_overlap = 1.0;  // extend into wall for solid union",
        f"",
        f"    for (s = [0 : starts - 1]) {{",
        f"        sa = s * 360 / starts;",
        f"        for (i = [0 : total_segs - 1]) {{",
        f"            hull() {{",
        f"                // Current slice",
        f"                rotate([0, 0, sa + i * 360 / segs_per_turn])",
        f"                translate([bore_r - depth, -0.01,",
        f"                           i * lead / segs_per_turn])",
        f"                cube([depth + wall_overlap, 0.02, thread_width]);",
        f"",
        f"                // Next slice",
        f"                rotate([0, 0, sa + (i+1) * 360 / segs_per_turn])",
        f"                translate([bore_r - depth, -0.01,",
        f"                           (i+1) * lead / segs_per_turn])",
        f"                cube([depth + wall_overlap, 0.02, thread_width]);",
        f"            }}",
        f"        }}",
        f"    }}",
        f"}}",
        f"",
        f"// ============================================================",
        f"// female_cap -- a threaded female cap, opening at z = 0",
        f"// ============================================================",
        f"module female_cap(bore_r, outer_r, lead, starts, depth,",
        f"                  thread_width, engage_h, pitch, cap_h) {{",
        f"    union() {{",
        f"        // Outer shell with smooth bore",
        f"        difference() {{",
        f"            cylinder(r = outer_r, h = cap_h);",
        f"            translate([0, 0, -0.01])",
        f"                cylinder(r = bore_r, h = cap_h + 0.02);",
        f"        }}",
        f"        // Helical thread ridges -- offset by one pitch for lead-in",
        f"        translate([0, 0, pitch])",
        f"        thread_ridges(bore_r, lead, starts, depth,",
        f"                      thread_width, engage_h);",
        f"    }}",
        f"}}",
        f"",
        f"// ============================================================",
        f"// Assembly",
        f"// ============================================================",
        f"difference() {{",
        f"    union() {{",
        f"        // ── Cap A -- opening faces -Z (bottom of adapter)",
        f"        female_cap(A_bore_r, A_outer_r, A_lead, A_starts, A_depth,",
        f"                   A_thread_width, A_engage_h, A_pitch, A_cap_h);",
        f"",
        f"        // ── Connector cylinder",
        f"        translate([0, 0, A_cap_h])",
        f"            cylinder(r = conn_r, h = conn_h);",
        f"",
        f"        // ── Cap B -- flipped so opening faces +Z (top)",
        f"        translate([0, 0, A_cap_h + conn_h + B_cap_h])",
        f"        rotate([180, 0, 0])",
        f"        female_cap(B_bore_r, B_outer_r, B_lead, B_starts, B_depth,",
        f"                   B_thread_width, B_engage_h, B_pitch, B_cap_h);",
        f"    }}",
        f"",
        f"    // ── Flow-through bore",
        f"    // Each cap already has its own bore; just bore the connector.",
        f"    translate([0, 0, A_cap_h - 0.01])",
        f"        cylinder(r = flow_r, h = conn_h + 0.02);",
        f"}}",
    ]
    return "\n".join(lines) + "\n"


# ── STL rendering ─────────────────────────────────────────────────────────────

OPENSCAD_CANDIDATES = [
    "openscad",
    r"C:\Program Files\OpenSCAD\openscad.exe",
    r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
    "/usr/bin/openscad",
    "/usr/local/bin/openscad",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
]


def try_render(scad_path: str, stl_path: str) -> tuple[bool, str]:
    """
    Try each known OpenSCAD installation location.
    Returns (success, message).
    """
    for cmd in OPENSCAD_CANDIDATES:
        try:
            result = subprocess.run(
                [cmd, "-o", stl_path, scad_path],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                return True, cmd
            # OpenSCAD was found but reported an error
            return False, result.stderr.strip() or result.stdout.strip()
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            return False, "OpenSCAD timed out --the model may be very complex."
    return False, "OpenSCAD executable not found."


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print()
    print("=" * 56)
    print("       BOTTLE CAP ADAPTER GENERATOR")
    print("=" * 56)
    print()
    print("  This tool creates a 3D-printable adapter that")
    print("  connects two bottles with different cap sizes.")
    print()
    print("  Both ends have internal (female) threads --each")
    print("  end screws onto a bottle neck just like a cap.")
    print()
    print("  You will need:")
    print("    - Both bottles")
    print("    - Calipers or a ruler (measurements in mm)")

    bottle_a = prompt_bottle("Bottle A  -- screws into the BOTTOM of the adapter")
    bottle_b = prompt_bottle("Bottle B  -- screws into the TOP of the adapter")

    # ── Connector section ────────────────────────────────────────────────────
    print()
    print(f"  {'-'*54}")
    print("  Connector / Grip Section")
    print(f"  {'-'*54}")
    print()
    connector_h = ask_float(
        "Connector height (mm)",
        hint="The solid middle section between the two threaded ends.\n"
             "Taller = easier to grip when screwing bottles on.\n"
             "Set to 0 for a minimal adapter.",
        default=8.0, min_val=0.0, max_val=100.0,
    )

    # ── Output filename ──────────────────────────────────────────────────────
    print()
    print(f"  {'-'*54}")
    print("  Output")
    print(f"  {'-'*54}")
    print()
    raw = input("   -> Filename (no extension) [adapter]: ").strip()
    output = raw if raw else "adapter"

    # Always write output files to the same directory as the script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    scad_path = os.path.join(script_dir, output + ".scad")
    stl_path  = os.path.join(script_dir, output + ".stl")

    # ── Generate ─────────────────────────────────────────────────────────────
    scad = generate_scad(bottle_a, bottle_b, connector_h=connector_h)
    with open(scad_path, "w", encoding="utf-8") as f:
        f.write(scad)
    print(f"\n  OpenSCAD source saved : {os.path.abspath(scad_path)}")

    print("  Rendering STL via OpenSCAD CLI ...")
    ok, info = try_render(scad_path, stl_path)

    if ok:
        size_kb = os.path.getsize(stl_path) / 1024
        print(f"  STL rendered OK       : {os.path.abspath(stl_path)}"
              f"  ({size_kb:.0f} KB)")
        print()
        print("  Next steps:")
        print("    1. Open Bambu Studio")
        print("    2. File > Import > select the STL file")
        print("    3. Enable auto-supports for the upper bore overhang")
        print("    4. Slice at 0.2 mm layer height and print")
        print()
        print("  Tip: PETG or ASA recommended for chemical resistance")
        print("       with household cleaning products.")
    else:
        print(f"  Could not auto-render : {info}")
        print()
        print("  To generate the STL manually:")
        print("    1. Install OpenSCAD  ->  https://openscad.org/downloads.html")
        print(f"    2. Open  {scad_path}")
        print("    3. Press F6 to render (may take a minute)")
        print("    4. File > Export > Export as STL")
        print()
        print("  Or from the command line:")
        print(f'    openscad -o "{stl_path}" "{scad_path}"')


if __name__ == "__main__":
    main()
