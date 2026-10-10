export interface ClientPoint { readonly x: number; readonly y: number }
export interface ActionSize { readonly width: number; readonly height: number }
export interface ObjectActionLayout { readonly center: ClientPoint; readonly positions: readonly ClientPoint[]; readonly identity: ClientPoint; readonly close: ClientPoint; readonly compact: boolean }

export function maximumActionSize(sizes: readonly ActionSize[]): ActionSize {
  return { width: Math.max(44, ...sizes.map(size => size.width)), height: Math.max(44, ...sizes.map(size => size.height)) };
}

export function actionPage(length: number, capacity: number, requested: number) {
  const paged = length > capacity;
  const first = paged ? capacity - 1 : capacity;
  const later = Math.max(1, capacity - 2);
  const last = paged ? Math.ceil((length - first) / later) : 0;
  const page = Math.max(0, Math.min(last, requested));
  const start = page === 0 ? 0 : first + (page - 1) * later;
  const chunk = page === 0 ? first : later;
  return { page, indices: Array.from({ length: Math.min(chunk, length - start) }, (_, i) => start + i), back: page > 0, more: start + chunk < length };
}

/** Positions are top-left coordinates; their original action indices never change. */
export function layoutObjectActions(anchor: ClientPoint, sizes: readonly ActionSize[], viewport: ActionSize,
  top = 8, bottom = viewport.height - 8, identityHeight = 48, left = 8, right = viewport.width - 8): ObjectActionLayout {
  const width = Math.max(44, ...sizes.map(size => size.width));
  const height = Math.max(44, ...sizes.map(size => size.height));
  const availableWidth = right - left;
  const availableHeight = Math.max(height, bottom - top);
  const count = sizes.length;
  const centerHeight = identityHeight + 52;
  const identityOffset = -centerHeight / 2;
  const closeOffset = identityOffset + identityHeight + 8;
  const compact = availableWidth < 2 * width + 80 || availableHeight < (count === 2 ? centerHeight : 2 * height + centerHeight + 16);
  if (compact) {
    const center = { x: (left + right) / 2, y: top + identityHeight / 2 };
    const gap = 4;
    const columns = Math.max(1, Math.min(2, Math.floor((availableWidth + gap) / (width + gap))));
    const total = columns * width + (columns - 1) * gap;
    const start = Math.max(left, center.x - total / 2);
    return { center, compact, identity: { x: left, y: top }, close: { x: right - 44, y: top },
      positions: sizes.map((size, index) => ({ x: start + (index % columns) * (width + gap),
        y: top + Math.max(identityHeight, 44) + gap + Math.floor(index / columns) * (height + gap) })) };
  }
  const angles = count === 0 ? [] : count === 1 ? [-90] : count === 2 ? [180, 0] : count === 3 ? [-90, 30, 150]
    : count === 4 ? [-90, 0, 180, 90] : count === 5 ? [-90, -30, 210, 90, 30] : [-90, -30, 210, 90, 30, 150];
  const cosine = Math.max(...angles.map(angle => Math.abs(Math.cos(angle * Math.PI / 180))));
  const radiusX = Math.min(142, (availableWidth - width) / 2 / Math.max(cosine, 0.1));
  const preferredY = Math.max(count > 4 ? 2 * height + 16 : height + 8, 110, centerHeight / 2 + height / 2 + 8);
  const radiusY = count === 2 ? 0 : Math.min(preferredY, (availableHeight - height) / 2);
  const offsets = angles.map((angle, i) => ({ x: Math.cos(angle * Math.PI / 180) * radiusX - sizes[i].width / 2,
    y: Math.sin(angle * Math.PI / 180) * radiusY - sizes[i].height / 2 }));
  const minX = Math.min(-44, ...offsets.map(at => at.x)), maxX = Math.max(44, ...offsets.map((at, i) => at.x + sizes[i].width));
  const minY = Math.min(identityOffset, ...offsets.map(at => at.y)), maxY = Math.max(closeOffset + 44, ...offsets.map((at, i) => at.y + sizes[i].height));
  const center = { x: Math.max(left - minX, Math.min(right - maxX, anchor.x)),
    y: Math.max(top - minY, Math.min(bottom - maxY, anchor.y)) };
  return { center, compact, identity: { x: center.x - 44, y: center.y + identityOffset }, close: { x: center.x - 22, y: center.y + closeOffset }, positions: offsets.map(at => ({ x: center.x + at.x, y: center.y + at.y })) };
}


export interface ActionRegion { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface ActionPlacement { readonly region: ActionRegion; readonly capacity: number; readonly identityHeight: number; readonly scroll: boolean }

function intersects(a: ActionRegion, b: ActionRegion): boolean {
  return a.left < b.right - .25 && b.left < a.right - .25 && a.top < b.bottom - .25 && b.top < a.bottom - .25;
}

/** Obstacle edges bound every candidate, including areas beside a tall HUD. */
export function safeActionRegions(viewport: ActionSize, obstacles: readonly ActionRegion[]): ActionRegion[] {
  const outer = {left: 8, top: 8, right: viewport.width - 8, bottom: viewport.height - 8};
  const blockers = obstacles.filter(rect => rect.right > rect.left && rect.bottom > rect.top).map(rect => ({left: rect.left - 8, top: rect.top - 8, right: rect.right + 8, bottom: rect.bottom + 8}));
  const xs = [...new Set([outer.left, outer.right, ...blockers.flatMap(rect => [rect.left, rect.right])])].filter(x => x >= outer.left && x <= outer.right).sort((a,b) => a-b);
  const ys = [...new Set([outer.top, outer.bottom, ...blockers.flatMap(rect => [rect.top, rect.bottom])])].filter(y => y >= outer.top && y <= outer.bottom).sort((a,b) => a-b);
  const regions: ActionRegion[] = [];
  for (let l=0;l<xs.length;l++) for (let r=l+1;r<xs.length;r++) for (let t=0;t<ys.length;t++) for (let b=t+1;b<ys.length;b++) {
    const region = {left:xs[l], right:xs[r], top:ys[t], bottom:ys[b]};
    if (region.right-region.left >= 140 && region.bottom-region.top >= 44 && !blockers.some(blocker => intersects(region, blocker))) regions.push(region);
  }
  return regions;
}

/** Validate the final, clamped children rather than the original object anchor. */
export function actionLayoutFits(layout: ObjectActionLayout, sizes: readonly ActionSize[], identityHeight: number, region: ActionRegion): boolean {
  const boxes = layout.positions.map((at,i) => ({left:at.x,top:at.y,right:at.x+sizes[i].width,bottom:at.y+sizes[i].height}));
  if (identityHeight > 0) boxes.push({left:layout.identity.x,top:layout.identity.y,right:layout.identity.x+88,bottom:layout.identity.y+identityHeight});
  boxes.push({left:layout.close.x,top:layout.close.y,right:layout.close.x+44,bottom:layout.close.y+44});
  return boxes.every((box,i) => box.left >= region.left-.25 && box.top >= region.top-.25 && box.right <= region.right+.25 && box.bottom <= region.bottom+.25 && boxes.slice(i+1).every(other => !intersects(box,other)));
}

export function chooseActionPlacement(anchor: ClientPoint, entries: readonly ActionSize[], navigation: ActionSize, viewport: ActionSize,
  identityHeight: number, obstacles: readonly ActionRegion[]): ActionPlacement | null {
  const maximum = maximumActionSize([...entries,navigation]);
  const regions = safeActionRegions(viewport,obstacles);
  const candidates: {placement:ActionPlacement; distance:number; compact:boolean}[] = [];
  for (const capacity of [6,4,3]) {
    const pageCounts: number[] = [];
    for (let page=0;page<=entries.length;page++) {
      const part = actionPage(entries.length,capacity,page);
      pageCounts.push(part.indices.length+Number(part.back)+Number(part.more));
      if (!part.more) break;
    }
    for (const region of regions) {
      const width = region.right-region.left, height = region.bottom-region.top;
      if (width < maximum.width) continue;
      const columns = Math.max(1,Math.min(2,Math.floor((width+4)/(maximum.width+4))));
      const rows = Math.ceil(Math.max(...pageCounts)/columns);
      const limitedHeight = Math.min(identityHeight,Math.max(44,height-rows*(maximum.height+4)));
      let nearest = Infinity, valid = true, compact = false;
      for (const count of new Set(pageCounts)) {
        const sizes = Array.from({length:count},()=>maximum);
        const layout = layoutObjectActions(anchor,sizes,viewport,region.top,region.bottom,limitedHeight,region.left,region.right);
        compact ||= layout.compact;
        if (!actionLayoutFits(layout,sizes,limitedHeight,region)) {valid=false;break;}
        nearest = Math.min(nearest,(layout.center.x-anchor.x)**2+(layout.center.y-anchor.y)**2);
      }
      if (valid) candidates.push({placement:{region,capacity,identityHeight:limitedHeight,scroll:false},distance:nearest,compact});
    }
  }
  candidates.sort((a,b) => Number(a.compact)-Number(b.compact) || b.placement.capacity-a.placement.capacity || a.distance-b.distance || (b.placement.region.right-b.placement.region.left)*(b.placement.region.bottom-b.placement.region.top)-(a.placement.region.right-a.placement.region.left)*(a.placement.region.bottom-a.placement.region.top));
  if (candidates.length) return candidates[0].placement;
  // The compact scroller retains minimum targets when a complete page cannot fit.
  const fallback = regions.filter(region => region.right-region.left >= maximum.width && region.bottom-region.top >= 96).sort((a,b) => (b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  return fallback ? {region:fallback,capacity:3,identityHeight:Math.min(identityHeight,44),scroll:true} : null;
}
