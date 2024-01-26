export class Deque {
    private items: any[];
    private maxSize: number;

    constructor(maxSize: number) {
        this.items = [];
        this.maxSize = maxSize;
    }

    public addBack(element: any): void {
        if (this.items.length === this.maxSize) {
            this.items.shift(); // Remove o item mais antigo se o deque atingir o tamanho máximo
        }
        this.items.push(element);
    }

    public isEmpty(): boolean {
        return this.items.length === 0;
    }

    public getItems(): any[] {
        return [...this.items];
    }

    // Você pode adicionar mais métodos aqui conforme necessário, 
    // como removeFront, peekFront, peekBack, etc.
}
