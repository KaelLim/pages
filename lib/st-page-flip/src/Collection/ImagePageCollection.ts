import { ImagePage } from '../Page/ImagePage';
import { Render } from '../Render/Render';
import { PageCollection } from './PageCollection';
import { PageFlip } from '../PageFlip';
import { PageDensity } from '../Page/Page';

/**
 * Сlass representing a collection of pages as images on the canvas
 */
export class ImagePageCollection extends PageCollection {
    private readonly imagesHref: string[];

    constructor(app: PageFlip, render: Render, imagesHref: string[]) {
        super(app, render);

        this.imagesHref = imagesHref;
    }

    public load(): void {
        for (const href of this.imagesHref) {
            const page = new ImagePage(this.render, href, PageDensity.SOFT);

            page.load();
            this.pages.push(page);
        }

        this.addBlankPages();
        this.createSpread();
    }

    protected createBlankPage(): ImagePage {
        const blank = new ImagePage(
            this.render,
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            PageDensity.SOFT
        );
        blank.load();

        return blank;
    }
}
