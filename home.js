window.onload = async () => {
    //set up rotating images
    let allrot = document.querySelectorAll(".rotating");
    allrot.forEach((img) => {
        img.index =  Math.floor(Math.random() * 10);
        img.update = () => {
            let names = img.dataset.values.split(";");
            img.index++;
            img.src = "source/" + names[img.index % names.length];
            setTimeout(img.update, parseInt(img.dataset.speed));
        };
        img.update();
    });
};