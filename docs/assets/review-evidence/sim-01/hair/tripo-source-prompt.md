# Hair extraction prompt

Interface: built-in ChatGPT image generation. Exact model ID is not exposed.
Reference: `docs/assets/sim-hairstyles/01-small-front-curl.png`, edit target.

Use case: background-extraction.
Input image 1 is the edit target and exact approved hairstyle.
Extract ONLY the brown hair as a single isolated removable stylized hairpiece, preserving the existing camera angle, broad rolled front section, small hooked front curl, outward swept side lock, hairline outline, chestnut palette and painted shading exactly as closely as possible.
Remove the face, skin, ears, eyebrows, body, shirt and all background. Do not leave a mannequin or head inside the hair. Where the head has been removed, leave empty transparent space; preserve the complete hair contour including the small curl.
Center the complete hairpiece at large scale with padding, on a genuinely transparent background. High-resolution, smooth clean edges, no pixelation, no labels, no new strands, no redesign and no extra views.
This is the source for reconstructing this hairstyle as a separate 3D asset, not a new character design.
