//Menu.js

export function showMenu(type, x, y) {
    // First, hide all menus
    document.querySelectorAll('.contextMenu').forEach(menu => {
        menu.style.display = 'none';
    });

    // Then, display the desired menu
    const menu = document.getElementById(type + 'Menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
}

const hoverSound = new Audio('/audio/420997__eponn__click.mp3');
const clickSound = new Audio('/audio/multichime2.mp3');

const contextMenus = document.querySelectorAll('.contextMenu');
contextMenus.forEach(menu => {
    const buttons = menu.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('mouseover', () => {
            hoverSound.currentTime = 0;
            hoverSound.play();
            hoverSound.volume = 0.01;

        });
        button.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play();
            clickSound.volume = 0.1;
        });
    });
});

contextMenus.forEach(menu => {
    const buttons = menu.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('mouseenter', (event) => { // Add event as an argument
            console.log('mouseenter');
            setTimeout(() => {
                if (button.id === 'createButton') {
                    console.log('createButton');

                    const secondMenu = document.getElementById('secondMenu');
                    showMenu('second', event.clientX, event.clientY);
                    // secondMenu.classList.add('show');
                }
            }, 500);
        });
    });
});
