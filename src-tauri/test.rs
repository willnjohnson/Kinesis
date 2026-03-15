fn main() {
    let line = "db_path: D:\\my\\path";
    println!("{:?}", line.split_once(':'));
}
