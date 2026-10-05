"""Deterministic first-fit shelves in bounded, equally sized texture pages."""


def pack_pages(sizes, page_size=2048, padding=1):
    if (type(page_size) is not int or not 1 <= page_size <= 8192
            or type(padding) is not int or padding < 0):
        raise ValueError('Invalid texture page or padding')
    if any(type(w) is not int or type(h) is not int or w <= 0 or h <= 0
           or w+padding > page_size or h+padding > page_size for w, h in sizes):
        raise ValueError('Sprite does not fit a texture page')
    pages, placements = [], {}
    for index in sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0], i)):
        width, height = (value+padding for value in sizes[index])
        for page, shelves in enumerate(pages):
            found = next((shelf for shelf in shelves if shelf[1] >= height and shelf[2]+width <= page_size), None)
            if found is not None:
                placements[index] = (page, found[2], found[0])
                found[2] += width
                break
            y = sum(shelf[1] for shelf in shelves)
            if y+height <= page_size:
                shelves.append([y, height, width])
                placements[index] = (page, 0, y)
                break
        else:
            pages.append([[0, height, width]])
            placements[index] = (len(pages)-1, 0, 0)
    return placements, max(1, len(pages))
